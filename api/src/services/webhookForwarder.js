const logger = require('../utils/logger');
const fetch = require('node-fetch');
const crypto = require('crypto');
const vm = require('vm');
const jsonpath = require('jsonpath');
const _ = require('lodash');

/**
 * WebhookForwarder Service
 * A lightweight service to forward events to external services like Slack, Mixpanel, etc.
 * with powerful transformation capabilities
 */
class WebhookForwarder {
  constructor() {
    // Map of destinations: { "destinationName": { url, eventTypes, transform, headers } }
    this.destinations = {};
    
    // Map of registered transformers
    this.transformers = {
      slack: WebhookForwarder.slackTransformer,
      mixpanel: WebhookForwarder.mixpanelTransformer,
      identity: WebhookForwarder.identityTransformer,
      template: WebhookForwarder.templateTransformer,
      script: WebhookForwarder.scriptTransformer,
      jsonpath: WebhookForwarder.jsonPathTransformer,
      mapping: WebhookForwarder.mappingTransformer
    };
  }

  /**
   * Register a new webhook destination
   * @param {string} name - Unique identifier for the destination
   * @param {Object} config - Configuration object
   * @param {string} config.url - Webhook URL
   * @param {Array<string>|string} config.eventTypes - Event types to forward (or '*' for all)
   * @param {Function|Object} [config.transform] - Transformation function or configuration
   * @param {Object} [config.headers] - Additional headers to send
   * @param {string} [config.secret] - Secret for signing payloads (if supported)
   * @returns {Object} - The registered destination
   */
  registerDestination(name, config) {
    if (!name || !config.url) {
      throw new Error('Destination name and URL are required');
    }

    // Normalize eventTypes to array
    const eventTypes = config.eventTypes === '*' 
      ? '*' 
      : (Array.isArray(config.eventTypes) ? config.eventTypes : [config.eventTypes]);
    
    // Handle transform configuration - could be a function or an object with transformation config
    let transformFn;
    
    if (typeof config.transform === 'function') {
      // Direct function - use as is
      transformFn = config.transform;
    } else if (config.transform && typeof config.transform === 'object') {
      // Configuration object - resolve the transformer
      transformFn = this._resolveTransformer(config.transform);
    } else {
      // No transform specified - use identity transform
      transformFn = event => event;
    }

    this.destinations[name] = {
      url: config.url,
      eventTypes,
      transform: transformFn,
      headers: config.headers || {},
      secret: config.secret,
      enabled: config.enabled !== false,
      method: config.method || 'POST',
      timeout: config.timeout || 5000
    };

    logger.info(`Registered webhook destination: ${name}`);
    return this.destinations[name];
  }

  /**
   * Remove a webhook destination
   * @param {string} name - Destination name to remove
   * @returns {boolean} - Whether the destination was found and removed
   */
  removeDestination(name) {
    if (this.destinations[name]) {
      delete this.destinations[name];
      logger.info(`Removed webhook destination: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a destination
   * @param {string} name - Destination name
   * @param {boolean} enabled - Whether to enable (true) or disable (false)
   * @returns {boolean} - Success status
   */
  setDestinationStatus(name, enabled) {
    if (this.destinations[name]) {
      this.destinations[name].enabled = enabled;
      logger.info(`${enabled ? 'Enabled' : 'Disabled'} webhook destination: ${name}`);
      return true;
    }
    return false;
  }
  
  /**
   * Get all registered destinations
   * @returns {Object} - Map of registered destinations
   */
  getDestinations() {
    return { ...this.destinations };
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
   * Process an event and forward it to matching destinations
   * @param {Object} event - The event to process
   * @returns {Promise<Array>} - Results of the forwarding operations
   */
  async processEvent(event) {
    if (!event || !event.eventName) {
      logger.warn('Attempted to process invalid event');
      return [];
    }

    logger.debug(`Processing event for webhook forwarding: ${event.eventName}`);
    const results = [];

    // Find all destinations that match this event type
    const matchingDestinations = Object.entries(this.destinations).filter(([name, config]) => {
      return config.enabled && (
        config.eventTypes === '*' || 
        config.eventTypes.includes(event.eventName)
      );
    });

    // Send to each matching destination
    for (const [name, config] of matchingDestinations) {
      try {
        const result = await this._sendToDestination(name, config, event);
        results.push(result);
      } catch (error) {
        logger.error(`Error forwarding event to ${name}:`, {
          error: error.message,
          eventId: event.id,
          eventName: event.eventName
        });
        
        results.push({
          destination: name,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Send an event to a specific destination
   * @private
   * @param {string} name - Destination name
   * @param {Object} config - Destination configuration
   * @param {Object} event - Event to send
   * @returns {Promise<Object>} - Result of the send operation
   */
  async _sendToDestination(name, config, event) {
    logger.debug(`Forwarding event ${event.eventName} to ${name}`);
    
    try {
      // Transform the event according to destination requirements
      const payload = await this._safeTransform(config.transform, event, name);
      
      // Set up default headers
      const headers = {
        'Content-Type': 'application/json',
        ...config.headers
      };
      
      // Add signature if secret is provided
      if (config.secret) {
        const signature = this._generateSignature(payload, config.secret);
        headers['X-Webhook-Signature'] = signature;
      }
      
      // Determine request body based on content type
      let body;
      const contentType = headers['Content-Type']?.toLowerCase() || 'application/json';
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Convert payload to URL-encoded form data
        body = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
          if (typeof value === 'object') {
            body.append(key, JSON.stringify(value));
          } else {
            body.append(key, String(value));
          }
        });
      } else if (contentType.includes('multipart/form-data')) {
        // Use FormData for multipart requests
        body = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (typeof value === 'object') {
            body.append(key, JSON.stringify(value));
          } else {
            body.append(key, String(value));
          }
        });
      } else {
        // Default to JSON
        body = JSON.stringify(payload);
      }
      
      // Send the webhook request
      const response = await fetch(config.url, {
        method: config.method || 'POST',
        headers,
        body,
        timeout: config.timeout || 5000
      });
      
      // Check response
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
      }
      
      // Try to parse response as JSON, but don't fail if it's not
      let responseData;
      try {
        responseData = await response.json();
      } catch (e) {
        responseData = await response.text();
      }
      
      logger.info(`Successfully forwarded event to ${name}`);
      
      return {
        destination: name,
        success: true,
        statusCode: response.status,
        response: responseData
      };
    } catch (error) {
      logger.error(`Failed to forward event to ${name}:`, {
        error: error.message,
        stack: error.stack,
        eventId: event.id
      });
      
      throw error;
    }
  }
  
  /**
   * Safely execute a transform function with error handling
   * @private
   * @param {Function} transformFn - The transform function to execute
   * @param {Object} event - The event to transform
   * @param {string} destinationName - The destination name (for logging)
   * @returns {Promise<Object>} - The transformed payload
   */
  async _safeTransform(transformFn, event, destinationName) {
    try {
      // Handle both synchronous and asynchronous transformers
      const result = transformFn(event);
      
      // If the result is a Promise, await it
      if (result instanceof Promise) {
        return await result;
      }
      
      return result;
    } catch (error) {
      logger.error(`Error in transform function for ${destinationName}:`, {
        error: error.message,
        stack: error.stack,
        eventId: event.id,
        eventName: event.eventName
      });
      
      // If transformation fails, use a minimal payload to avoid breaking the webhook
      return {
        eventName: event.eventName,
        eventId: event.id,
        timestamp: event.timestamp,
        error: `Transform error: ${error.message}`
      };
    }
  }
  
  /**
   * Resolve a transformer from configuration object
   * @private
   * @param {Object} config - Transform configuration
   * @returns {Function} - Transform function
   */
  _resolveTransformer(config) {
    // If no type specified, use identity transform
    const type = config.type || 'identity';
    
    // Look up the transformer factory by type
    const transformerFactory = this.transformers[type];
    
    if (!transformerFactory) {
      logger.warn(`Unknown transformer type '${type}', using identity transformer`);
      return this.transformers.identity();
    }
    
    // Create and return the transform function
    return transformerFactory(config);
  }
  
  /**
   * Generate a signature for the payload
   * @private
   * @param {Object} payload - The payload to sign
   * @param {string} secret - Secret key
   * @returns {string} - The signature
   */
  _generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return hmac.digest('hex');
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
   * Pre-configured transformer for Slack
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static slackTransformer(options = {}) {
    const defaults = {
      username: 'Event Notifier',
      icon_emoji: ':bell:',
      channel: '#events'
    };
    
    const config = { ...defaults, ...(options.config || options) };
    
    return (event) => {
      // Basic slack message format
      const message = {
        username: config.username,
        icon_emoji: config.icon_emoji,
        channel: config.channel,
        text: `*${event.eventName}* event received`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${event.eventName}* event received at ${new Date(event.timestamp).toLocaleString()}`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*ID:*\n${event.id}`
              },
              {
                type: "mrkdwn",
                text: `*Timestamp:*\n${new Date(event.timestamp).toLocaleString()}`
              }
            ]
          }
        ]
      };
      
      // Add properties as a JSON code block
      if (event.properties && Object.keys(event.properties).length > 0) {
        message.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Properties:*"
          }
        });
        
        message.blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "```" + JSON.stringify(event.properties, null, 2) + "```"
          }
        });
      }
      
      // If there's a custom message format provided, use it
      if (config.message) {
        message.text = config.message.replace(/\{(\w+)(?:\.([^}]+))?\}/g, (match, key, path) => {
          if (key === 'event') {
            if (!path) return event.eventName;
            return _.get(event, path, match);
          }
          return match;
        });
      }
      
      // If there are custom blocks, use them instead
      if (config.blocks) {
        message.blocks = config.blocks.map(block => {
          // Deep clone the block to avoid modifying the template
          const processedBlock = JSON.parse(JSON.stringify(block));
          
          // Process template strings in the block
          JSON.stringify(processedBlock, (key, value) => {
            if (typeof value === 'string') {
              return value.replace(/\{(\w+)(?:\.([^}]+))?\}/g, (match, key, path) => {
                if (key === 'event') {
                  if (!path) return event.eventName;
                  return _.get(event, path, match);
                }
                return match;
              });
            }
            return value;
          });
          
          return processedBlock;
        });
      }
      
      return message;
    };
  }
  
  /**
   * Pre-configured transformer for Mixpanel
   * @static
   * @param {Object} options - Configuration options
   * @returns {Function} - Transform function
   */
  static mixpanelTransformer(options = {}) {
    const config = options.config || options || {};
    
    return (event) => {
      // Default properties
      const baseProperties = {
        time: new Date(event.timestamp).getTime(),
        distinct_id: event.properties.userId || 'anonymous',
        $insert_id: event.id // prevent duplicates
      };
      
      // Determine which properties to include
      let eventProperties;
      
      if (config.includeProperties === false) {
        // Don't include original properties at all
        eventProperties = { ...baseProperties };
      } else if (Array.isArray(config.includeProperties)) {
        // Only include specific properties
        eventProperties = { ...baseProperties };
        config.includeProperties.forEach(prop => {
          if (event.properties[prop] !== undefined) {
            eventProperties[prop] = event.properties[prop];
          }
        });
      } else if (Array.isArray(config.excludeProperties)) {
        // Include all properties except excluded ones
        eventProperties = { ...baseProperties, ...event.properties };
        config.excludeProperties.forEach(prop => {
          delete eventProperties[prop];
        });
      } else {
        // Include all properties (default)
        eventProperties = { ...baseProperties, ...event.properties };
      }
      
      // Allow customizing the event name
      const eventName = config.eventNamePrefix 
        ? `${config.eventNamePrefix}${event.eventName}`
        : event.eventName;
      
      return {
        event: eventName,
        properties: eventProperties
      };
    };
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
          moment: require('moment'),
          utils: {
            timestamp: (date = new Date()) => Math.floor(date.getTime() / 1000),
            format: (date, format = 'YYYY-MM-DD HH:mm:ss') => 
              require('moment')(date).format(format),
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
    
    // Create a new context for the script
    const context = vm.createContext({
      console: {
        log: (...args) => logger.debug('Script transformer:', ...args),
        error: (...args) => logger.error('Script transformer:', ...args),
        warn: (...args) => logger.warn('Script transformer:', ...args)
      },
      _: _,
      moment: require('moment'),
      Buffer: Buffer,
      JSON: JSON
    });
    
    // Compile the script
    let script;
    try {
      // Wrap the script in a function
      const wrappedScript = `
        (function(event) {
          ${config.script}
        })
      `;
      script = new vm.Script(wrappedScript);
      
      // Test compile by running with an empty event
      const testFn = script.runInContext(context);
      if (typeof testFn !== 'function') {
        throw new Error('Script must return a function');
      }
    } catch (error) {
      logger.error('Error compiling script transformer:', error);
      throw new Error(`Invalid script: ${error.message}`);
    }
    
    return (event) => {
      try {
        // Get the transform function from the script
        const transformFn = script.runInContext(context);
        
        // Run it with the event
        return transformFn(event);
      } catch (error) {
        logger.error('Error running script transformer:', error);
        throw new Error(`Script execution error: ${error.message}`);
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
}