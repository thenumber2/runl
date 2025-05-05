const logger = require('../utils/logger');
const jsonpath = require('jsonpath');
const _ = require('lodash');
const moment = require('moment');

/**
 * TransformerService
 * Centralized service for event transformations
 * Used by both webhookForwarder and eventRouter
 */
class TransformerService {
  constructor() {
    // Map of registered transformers
    this.transformers = {
      identity: TransformerService.identityTransformer,
      template: TransformerService.templateTransformer,
      script: TransformerService.scriptTransformer,
      jsonpath: TransformerService.jsonPathTransformer,
      mapping: TransformerService.mappingTransformer,
      slack: TransformerService.slackTransformer,
      mixpanel: TransformerService.mixpanelTransformer
    };
  }

  /**
   * Register a custom transformer
   * @param {string} name - Transformer name
   * @param {Function} transformerFactory - Function that returns a transform function
   * @returns {void}
   */
  registerTransformer(name, transformerFactory) {
    if (typeof transformerFactory !== 'function') {
      throw new Error('Transformer factory must be a function');
    }
    
    this.transformers[name] = transformerFactory;
    logger.info(`Registered custom transformer: ${name}`);
  }

  /**
   * Create a transformer function from configuration
   * @param {Object|string} config - Transformer configuration or type
   * @returns {Function} - Transform function
   */
  createTransformer(config) {
    // Handle string type (e.g., "identity")
    if (typeof config === 'string') {
      config = { type: config };
    }
    
    // Extract type, default to identity
    const type = config.type || 'identity';
    
    // Look up the transformer factory
    const transformerFactory = this.transformers[type];
    
    if (!transformerFactory) {
      logger.warn(`Unknown transformer type '${type}', using identity transformer`);
      return this.transformers.identity();
    }
    
    // Create and return the transform function
    return transformerFactory(config);
  }

  /**
   * Safely apply a transformation with error handling
   * @param {Function} transformFn - The transform function
   * @param {Object} event - The event to transform
   * @param {string} context - Context info for logging
   * @returns {Promise<Object>} - The transformed data
   */
  async safeTransform(transformFn, event, context) {
    try {
      // Handle both synchronous and asynchronous transformers
      const result = transformFn(event);
      
      // If the result is a Promise, await it
      if (result instanceof Promise) {
        return await result;
      }
      
      return result;
    } catch (error) {
      logger.error(`Error in transform function (${context}):`, {
        error: error.message,
        stack: error.stack,
        eventId: event.id,
        eventName: event.eventName
      });
      
      // If transformation fails, return minimal data to avoid breaking the pipeline
      return {
        eventName: event.eventName,
        eventId: event.id,
        timestamp: event.timestamp,
        error: `Transform error: ${error.message}`
      };
    }
  }

  /**
   * Identity transformer - returns the event unchanged
   * @static
   * @returns {Function} - Transform function
   */
  static identityTransformer() {
    return (event) => event;
  }
  
  /**
   * Template-based transformer that uses lodash template strings
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static templateTransformer(options = {}) {
    const config = options.config || options || {};
    
    if (!config.template && !config.templates) {
      throw new Error('Template transformer requires a template or templates configuration');
    }
    
    // Compile templates
    let compiledTemplate;
    let compiledTemplates = {};
    
    if (config.template) {
      // Single template
      try {
        compiledTemplate = _.template(config.template);
      } catch (error) {
        logger.error('Error compiling template:', error);
        throw new Error(`Invalid template: ${error.message}`);
      }
    } else if (config.templates) {
      // Multiple templates
      try {
        Object.entries(config.templates).forEach(([key, tpl]) => {
          compiledTemplates[key] = _.template(tpl);
        });
      } catch (error) {
        logger.error('Error compiling templates:', error);
        throw new Error(`Invalid templates: ${error.message}`);
      }
    }
    
    return (event) => {
      try {
        // Prepare template data
        const templateData = {
          event,
          _,
          moment,
          utils: {
            timestamp: (date = new Date()) => Math.floor(date.getTime() / 1000),
            format: (date, format = 'YYYY-MM-DD HH:mm:ss') => 
              moment(date).format(format),
            get: (obj, path, defaultValue) => _.get(obj, path, defaultValue),
            parseJSON: (str, defaultValue = {}) => {
              try {
                return JSON.parse(str);
              } catch (e) {
                return defaultValue;
              }
            }
          }
        };
        
        if (compiledTemplate) {
          // Single template - render to string then parse as JSON
          const rendered = compiledTemplate(templateData);
          try {
            return JSON.parse(rendered);
          } catch (e) {
            // If not valid JSON, return as text
            return rendered;
          }
        } else {
          // Multiple templates - render each template and construct object
          const result = {};
          
          Object.entries(compiledTemplates).forEach(([key, tpl]) => {
            const rendered = tpl(templateData);
            try {
              // Try to parse as JSON if it looks like JSON
              if (rendered.trim().startsWith('{') || rendered.trim().startsWith('[')) {
                result[key] = JSON.parse(rendered);
              } else {
                result[key] = rendered;
              }
            } catch (e) {
              // If parsing fails, use the raw string
              result[key] = rendered;
            }
          });
          
          return result;
        }
      } catch (error) {
        logger.error('Error rendering template:', error);
        throw new Error(`Template rendering error: ${error.message}`);
      }
    };
  }
  
  /**
   * JavaScript scripted transformer that executes custom code
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static scriptTransformer(options = {}) {
    const config = options.config || options || {};
    
    if (!config.script) {
      throw new Error('Script transformer requires a script configuration');
    }
    
    // Define safe operations in a limited scope
    const safeTransformOperations = {
      get: (obj, path, defaultValue) => _.get(obj, path, defaultValue),
      set: (obj, path, value) => _.set(obj, path, value),
      pick: (obj, paths) => _.pick(obj, paths),
      omit: (obj, paths) => _.omit(obj, paths),
      merge: (obj1, obj2) => _.merge({}, obj1, obj2),
      format: (date, format = 'YYYY-MM-DD HH:mm:ss') => 
        moment(date).format(format),
      timestamp: (date = new Date()) => Math.floor(date.getTime() / 1000),
      parseJSON: (str, defaultValue = {}) => {
        try {
          return JSON.parse(str);
        } catch (e) {
          return defaultValue;
        }
      },
      filter: (array, predicate) => _.filter(array, predicate),
      map: (array, mapper) => _.map(array, mapper),
      includes: (collection, value) => _.includes(collection, value)
    };
    
    return (event) => {
      try {
        // Create a safe event deep clone to prevent modifications to the original
        const eventCopy = _.cloneDeep(event);
        const result = {}; // Default empty result
        
        // Execute pre-defined operations based on script configuration
        const scriptConfig = JSON.parse(config.script);
        
        // Apply defined operations in sequence
        if (Array.isArray(scriptConfig.operations)) {
          scriptConfig.operations.forEach(op => {
            if (!op.type || !safeTransformOperations[op.type]) {
              logger.warn(`Unknown operation type: ${op.type}`);
              return;
            }
            
            try {
              // Apply the operation with safety constraints
              const opResult = safeTransformOperations[op.type](
                ...op.args.map(arg => {
                  // Handle special event reference
                  if (arg === '$event') return eventCopy;
                  if (arg === '$result') return result;
                  return arg;
                })
              );
              
              // Store in result or apply to existing result
              if (op.target === '$result') {
                Object.assign(result, opResult);
              } else if (op.target) {
                _.set(result, op.target, opResult);
              }
            } catch (opError) {
              logger.error(`Error in operation ${op.type}:`, opError);
            }
          });
        }
        
        // Apply simple fixed field mapping from config
        if (scriptConfig.fieldMapping) {
          Object.entries(scriptConfig.fieldMapping).forEach(([target, source]) => {
            _.set(result, target, _.get(eventCopy, source));
          });
        }
        
        // Include all original properties if specified
        if (scriptConfig.includeOriginal) {
          Object.assign(result, eventCopy);
        }
        
        return Object.keys(result).length > 0 ? result : eventCopy;
      } catch (error) {
        logger.error('Error executing script transformer:', error);
        // Return a safe fallback on error
        return {
          error: 'Transformation error',
          originalEvent: {
            id: event.id,
            eventName: event.eventName,
            timestamp: event.timestamp
          }
        };
      }
    };
  }
  
  /**
   * JSONPath transformer for extracting/reorganizing data
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static jsonPathTransformer(options = {}) {
    const config = options.config || options || {};
    
    if (!config.mapping) {
      throw new Error('JSONPath transformer requires a mapping configuration');
    }
    
    return (event) => {
      try {
        const result = {};
        
        // Apply each JSONPath mapping
        Object.entries(config.mapping).forEach(([outputKey, pathExpr]) => {
          try {
            const extracted = jsonpath.query(event, pathExpr);
            if (extracted.length === 1) {
              // Single result - use the direct value
              result[outputKey] = extracted[0];
            } else if (extracted.length > 1) {
              // Multiple results - use an array
              result[outputKey] = extracted;
            } else {
              // No results - use null or a default value
              result[outputKey] = config.defaults?.[outputKey] || null;
            }
          } catch (error) {
            logger.error(`Error applying JSONPath '${pathExpr}':`, error);
            result[outputKey] = config.defaults?.[outputKey] || null;
          }
        });
        
        return result;
      } catch (error) {
        logger.error('Error in JSONPath transformer:', error);
        throw error;
      }
    };
  }
  
  /**
   * Simple mapping transformer for field renaming and filtering
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static mappingTransformer(options = {}) {
    const config = options.config || options || {};
    
    if (!config.mapping) {
      throw new Error('Mapping transformer requires a mapping configuration');
    }
    
    return (event) => {
      try {
        const result = {};
        
        // Apply basic field mapping
        Object.entries(config.mapping).forEach(([targetField, sourceField]) => {
          if (typeof sourceField === 'string') {
            // Simple field mapping
            result[targetField] = _.get(event, sourceField);
          } else if (Array.isArray(sourceField)) {
            // Array of possible source fields, use first non-undefined
            for (const field of sourceField) {
              const value = _.get(event, field);
              if (value !== undefined) {
                result[targetField] = value;
                break;
              }
            }
          } else if (typeof sourceField === 'object' && sourceField !== null) {
            // Object with value and default
            result[targetField] = _.get(event, sourceField.path, sourceField.default);
          }
        });
        
        // Include original fields if requested
        if (config.includeOriginal) {
          if (Array.isArray(config.includeOriginal)) {
            // Include specific original fields
            config.includeOriginal.forEach(field => {
              if (_.has(event, field) && !result[field]) {
                result[field] = _.get(event, field);
              }
            });
          } else if (config.includeOriginal === true) {
            // Include all original fields that aren't already mapped
            Object.entries(event).forEach(([key, value]) => {
              if (!result[key]) {
                result[key] = value;
              }
            });
          }
        }
        
        // Add fixed values
        if (config.fixed && typeof config.fixed === 'object') {
          Object.entries(config.fixed).forEach(([key, value]) => {
            result[key] = value;
          });
        }
        
        return result;
      } catch (error) {
        logger.error('Error in mapping transformer:', error);
        throw error;
      }
    };
  }
  
  /**
   * Slack transformer for formatting Slack webhook payloads
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static slackTransformer(options = {}) {
    const config = options.config || options || {};
    
    return (event) => {
      try {
        // Create Slack message format
        const slackPayload = {
          text: _.get(config, 'message', `New event: ${event.eventName}`),
          username: _.get(config, 'username'),
          icon_emoji: _.get(config, 'icon_emoji'),
          channel: _.get(config, 'channel')
        };
        
        // Add blocks if defined
        if (config.blocks) {
          slackPayload.blocks = _.cloneDeep(config.blocks);
          
          // Process any template strings in the blocks
          JSON.stringify(slackPayload.blocks).replace(
            /\$\{([^}]+)\}/g, 
            (match, path) => _.get(event, path, '')
          );
        } else {
          // Default fallback - create a simple block with event info
          slackPayload.blocks = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Event:* ${event.eventName}\n*Time:* ${new Date(event.timestamp).toISOString()}`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Properties:*\n\`\`\`${JSON.stringify(event.properties, null, 2)}\`\`\``
              }
            }
          ];
        }
        
        return slackPayload;
      } catch (error) {
        logger.error('Error in Slack transformer:', error);
        throw error;
      }
    };
  }
  
  /**
   * Mixpanel transformer for formatting Mixpanel API payloads
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static mixpanelTransformer(options = {}) {
    const config = options.config || options || {};
    
    return (event) => {
      try {
        // Create Mixpanel event format
        const eventName = config.eventNamePrefix 
          ? `${config.eventNamePrefix}${event.eventName}`
          : event.eventName;
        
        let properties = { ...event.properties };
        
        // Process properties based on configuration
        if (config.includeProperties === false) {
          properties = {};
        } else if (Array.isArray(config.includeProperties)) {
          properties = _.pick(properties, config.includeProperties);
        }
        
        // Exclude specific properties
        if (Array.isArray(config.excludeProperties)) {
          properties = _.omit(properties, config.excludeProperties);
        }
        
        // Ensure required Mixpanel fields
        if (!properties.distinct_id && properties.userId) {
          properties.distinct_id = properties.userId;
        }
        
        if (!properties.time) {
          properties.time = Math.floor(new Date(event.timestamp).getTime() / 1000);
        }
        
        // Mixpanel track API expects this format
        return {
          event: eventName,
          properties
        };
      } catch (error) {
        logger.error('Error in Mixpanel transformer:', error);
        throw error;
      }
    };
  }
}

// Export singleton instance
module.exports = new TransformerService();