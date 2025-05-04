const logger = require('../utils/logger');
const Route = require('../models/Route');
const Transformation = require('../models/Transformation');
const Destination = require('../models/Destination');
const jsonpath = require('jsonpath');
const _ = require('lodash');
const transformerService = require('./transformerService');

/**
 * Event Router Service
 * Routes incoming events to the proper destinations based on configured routes
 */
class EventRouter {
  constructor() {
    this.routes = [];
    this.initialized = false;
  }

  /**
   * Initialize the router by loading all active routes from the database
   * @returns {Promise<void>}
   * @throws {Error} If routes cannot be loaded
   */
  async initialize() {
    try {
      await this.refreshRoutes();
      this.initialized = true;
      logger.info('Event Router initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize EventRouter:', {
        error: error.message,
        stack: error.stack
      });
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Load all active routes from the database
   * @returns {Promise<void>}
   * @throws {Error} If routes cannot be loaded
   */
  async refreshRoutes() {
    try {
      // Get all enabled routes with their transformations and destinations
      const routes = await Route.findAll({
        where: { enabled: true },
        include: [
          {
            model: Transformation,
            as: 'transformation',
            where: { enabled: true }
          },
          {
            model: Destination,
            as: 'destination',
            where: { enabled: true }
          }
        ],
        order: [['priority', 'ASC']]
      });

      this.routes = routes;
      logger.info(`Loaded ${routes.length} active routes`);
    } catch (error) {
      logger.error('Error refreshing routes:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Route an event to all matching destinations
   * @param {Object} event - The event to route
   * @returns {Promise<Array>} - Results of the routing operations
   */
  async routeEvent(event) {
    try {
      // Initialize if not already done
      if (!this.initialized) {
        try {
          await this.initialize();
        } catch (error) {
          logger.error('Failed to initialize EventRouter during routeEvent:', {
            error: error.message,
            stack: error.stack
          });
          return [];
        }
      }

      // Validate event
      if (!event || !event.eventName) {
        logger.warn('Attempted to route invalid event');
        return [];
      }

      logger.debug(`Routing event: ${event.eventName}`, {
        eventId: event.id,
        routesCount: this.routes.length
      });

      const results = [];
      const webhookForwarder = require('./webhookForwarder');

      // Process each route that matches this event
      for (const route of this.routes) {
        try {
          // Skip disabled routes (though they should already be filtered out)
          if (!route.enabled) continue;

          // Check if event matches this route
          if (!this._eventMatchesRoute(event, route)) {
            continue;
          }

          logger.debug(`Event ${event.eventName} matches route ${route.name}`);

          // Transform and send the event
          const result = await this._processMatchingRoute(event, route, webhookForwarder);
          results.push(result);
        } catch (error) {
          logger.error(`Error processing route ${route.name} for event ${event.eventName}:`, {
            error: error.message,
            stack: error.stack,
            eventId: event.id,
            routeId: route.id
          });

          results.push({
            routeId: route.id,
            routeName: route.name,
            success: false,
            destination: route.destination?.name,
            error: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      logger.info(`Routed event ${event.eventName} to ${successCount}/${results.length} destinations`);

      return results;
    } catch (error) {
      logger.error(`Unexpected error routing event:`, {
        error: error.message,
        stack: error.stack,
        eventName: event?.eventName,
        eventId: event?.id
      });
      return [];
    }
  }

  /**
   * Process a route that matches an event
   * @private
   * @param {Object} event - The event to process
   * @param {Object} route - The matching route
   * @param {Object} webhookForwarder - The webhook forwarder service
   * @returns {Promise<Object>} - Result of the routing operation
   */
  async _processMatchingRoute(event, route, webhookForwarder) {
    try {
      // Transform the event
      const transformedEvent = await this._applyTransformation(
        event,
        route.transformation
      );

      // Forward to destination
      const result = await this._sendToDestination(
        transformedEvent,
        route.destination,
        webhookForwarder
      );

      // Update usage statistics for the route
      await route.update({
        lastUsed: new Date(),
        useCount: route.useCount + 1
      });

      return {
        routeId: route.id,
        routeName: route.name,
        success: result.success,
        destination: route.destination.name,
        error: result.error
      };
    } catch (error) {
      logger.error(`Error in _processMatchingRoute:`, {
        error: error.message,
        stack: error.stack,
        routeId: route.id,
        routeName: route.name
      });
      throw error;
    }
  }

  /**
   * Check if an event matches a route's criteria
   * @private
   * @param {Object} event - The event to check
   * @param {Object} route - The route to check against
   * @returns {boolean} - Whether the route matches
   */
  _eventMatchesRoute(event, route) {
    try {
      // First check if event name matches
      const eventTypeMatches = this._eventNameMatchesRoute(event.eventName, route.eventTypes);

      if (!eventTypeMatches) {
        return false;
      }

      // If there's a condition, evaluate it
      if (route.condition) {
        return this._evaluateCondition(event, route.condition);
      }

      return true;
    } catch (error) {
      logger.error(`Error in _eventMatchesRoute:`, {
        error: error.message,
        eventId: event.id,
        routeId: route.id
      });
      return false; // Fail safely by not matching on error
    }
  }

  /**
   * Check if event name matches the route patterns
   * @private
   * @param {string} eventName - The event name
   * @param {Array<string>} eventTypes - The route's event types
   * @returns {boolean} - Whether there's a match
   */
  _eventNameMatchesRoute(eventName, eventTypes) {
    try {
      // If eventTypes is not an array, treat it as a single string
      const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];

      // Handle wildcard - match all events
      if (types.includes('*')) {
        return true;
      }

      // Direct match
      if (types.includes(eventName)) {
        return true;
      }

      // Wildcard pattern matching
      for (const pattern of types) {
        if (typeof pattern !== 'string' || !pattern.includes('*')) {
          continue;
        }

        // Convert glob-style pattern to regex
        const regexPattern = pattern
          .replace(/\./g, '\\.')  // Escape dots
          .replace(/\*/g, '.*');  // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`);

        if (regex.test(eventName)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(`Error in _eventNameMatchesRoute:`, {
        error: error.message,
        eventName
      });
      return false; // Fail safely by not matching on error
    }
  }

  /**
   * Evaluate a route condition against an event
   * @private
   * @param {Object} event - The event to check
   * @param {Object} condition - The condition to evaluate
   * @returns {boolean} - Whether the condition is satisfied
   */
  _evaluateCondition(event, condition) {
    try {
      if (!condition || !condition.type) {
        return true;
      }

      switch (condition.type) {
        case 'property':
          return this._evaluatePropertyCondition(event, condition);

        case 'jsonpath':
          return this._evaluateJsonPathCondition(event, condition);

        case 'script':
          return this._evaluateScriptCondition(event, condition);

        default:
          logger.warn(`Unknown condition type: ${condition.type}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating condition:`, {
        error: error.message,
        conditionType: condition?.type
      });
      return false; // Fail safely on errors
    }
  }

  /**
   * Evaluate a property-based condition
   * @private
   * @param {Object} event - The event to check
   * @param {Object} condition - The condition to evaluate
   * @returns {boolean} - Whether the condition is satisfied
   */
  _evaluatePropertyCondition(event, condition) {
    try {
      const { property, operator, value } = condition;

      // Extract property value from event
      const propertyValue = this._getPropertyValue(event, property);

      // Handle property not found
      if (propertyValue === undefined) {
        return operator === 'exists' ? false : false;
      }

      switch (operator) {
        case 'exists':
          return true;

        case 'equals':
          return propertyValue === value;

        case 'contains':
          if (typeof propertyValue === 'string') {
            return propertyValue.includes(value);
          } else if (Array.isArray(propertyValue)) {
            return propertyValue.includes(value);
          }
          return false;

        case 'startsWith':
          return typeof propertyValue === 'string' && propertyValue.startsWith(value);

        case 'endsWith':
          return typeof propertyValue === 'string' && propertyValue.endsWith(value);

        case 'greaterThan':
          return propertyValue > value;

        case 'lessThan':
          return propertyValue < value;

        case 'in':
          return Array.isArray(value) && value.includes(propertyValue);

        default:
          logger.warn(`Unknown property operator: ${operator}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error in _evaluatePropertyCondition:`, {
        error: error.message,
        property: condition?.property
      });
      return false;
    }
  }

  /**
   * Evaluate a JSONPath condition
   * @private
   * @param {Object} event - The event to check
   * @param {Object} condition - The condition to evaluate
   * @returns {boolean} - Whether the condition is satisfied
   */
  _evaluateJsonPathCondition(event, condition) {
    try {
      const { path, operator, value } = condition;

      // Execute JSONPath query
      const results = jsonpath.query(event, path);

      switch (operator) {
        case 'exists':
          return results.length > 0;

        case 'equals':
          return results.length === 1 && results[0] === value;

        case 'contains':
          return results.some(result => {
            if (typeof result === 'string') {
              return result.includes(value);
            } else if (Array.isArray(result)) {
              return result.includes(value);
            }
            return false;
          });

        case 'count':
          return results.length === value;

        case 'greaterThan':
          return results.length === 1 && results[0] > value;

        case 'lessThan':
          return results.length === 1 && results[0] < value;

        default:
          logger.warn(`Unknown JSONPath operator: ${operator}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating JSONPath condition:`, {
        error: error.message,
        path: condition?.path
      });
      return false;
    }
  }

  /**
   * Evaluate a script-based condition
   * @private
   * @param {Object} event - The event to check
   * @param {Object} condition - The condition to evaluate
   * @returns {boolean} - Whether the condition is satisfied
   */
  _evaluateScriptCondition(event, condition) {
    try {
      if (!condition.script) {
        return false;
      }

      // Parse the condition script as a declarative configuration
      const scriptConfig = JSON.parse(condition.script);
      
      // Simple condition evaluator based on operations
      switch (scriptConfig.type) {
        case 'equals':
          return _.get(event, scriptConfig.field) === scriptConfig.value;
          
        case 'contains':
          const fieldValue = _.get(event, scriptConfig.field);
          if (typeof fieldValue === 'string') {
            return fieldValue.includes(scriptConfig.value);
          } else if (Array.isArray(fieldValue)) {
            return fieldValue.includes(scriptConfig.value);
          }
          return false;
          
        case 'gt':
          return _.get(event, scriptConfig.field) > scriptConfig.value;
          
        case 'lt':
          return _.get(event, scriptConfig.field) < scriptConfig.value;
          
        case 'regex': {
          const value = _.get(event, scriptConfig.field);
          if (typeof value !== 'string') return false;
          
          // Only allow safe regex patterns
          const safePattern = scriptConfig.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(safePattern, scriptConfig.flags || '');
          return regex.test(value);
        }
          
        case 'and':
          return scriptConfig.conditions.every(subCond => 
            this._evaluateScriptCondition(event, { script: JSON.stringify(subCond) })
          );
          
        case 'or':
          return scriptConfig.conditions.some(subCond => 
            this._evaluateScriptCondition(event, { script: JSON.stringify(subCond) })
          );
          
        case 'not':
          return !this._evaluateScriptCondition(
            event, 
            { script: JSON.stringify(scriptConfig.condition) }
          );
          
        default:
          logger.warn(`Unknown condition type: ${scriptConfig.type}`);
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating script condition:`, {
        error: error.message,
        script: condition?.script?.substring(0, 100) // Log just the first part of the script
      });
      return false;
    }
  }

  /**
   * Get a property value from an event
   * @private
   * @param {Object} event - The event
   * @param {string} property - The property path
   * @returns {*} - The property value
   */
  _getPropertyValue(event, property) {
    try {
      // Handle dot notation (e.g., "properties.userId")
      if (property.includes('.')) {
        return _.get(event, property);
      }

      // Direct property access
      return event[property];
    } catch (error) {
      logger.error(`Error in _getPropertyValue:`, {
        error: error.message,
        property
      });
      return undefined;
    }
  }

  /**
   * Apply a transformation to an event
   * @private
   * @param {Object} event - The event to transform
   * @param {Object} transformation - The transformation to apply
   * @returns {Promise<Object>} - The transformed event
   * @throws {Error} If transformation fails
   */
  async _applyTransformation(event, transformation) {
    try {
      // Create transformer from configuration
      const transformFn = transformerService.createTransformer({
        type: transformation.type,
        config: transformation.config
      });

      // Apply the transformation
      return await transformerService.safeTransform(
        transformFn,
        event,
        `route:transformation:${transformation.id}`
      );
    } catch (error) {
      logger.error(`Error applying transformation:`, {
        error: error.message,
        stack: error.stack,
        transformationType: transformation.type,
        transformationId: transformation.id,
        eventId: event.id
      });
      throw new Error(`Transformation failed: ${error.message}`);
    }
  }

  /**
   * Send an event to a destination
   * @private
   * @param {Object} event - The transformed event
   * @param {Object} destination - The destination
   * @param {Object} webhookForwarder - The webhook forwarder service
   * @returns {Promise<Object>} - The result
   * @throws {Error} If sending fails
   */
  async _sendToDestination(event, destination, webhookForwarder) {
    try {
      // Check if webhookForwarder is a class or an instance
      const forwarder = typeof webhookForwarder === 'function' 
        ? new webhookForwarder() 
        : webhookForwarder;

      // Ensure destination is registered
      await this._ensureDestinationRegistered(destination, forwarder);

      // Create a temporary event with the pre-transformed payload
      const tempEvent = this._createTempEvent(event);

      // Create identity transform destination
      const identityDestination = this._createIdentityDestination(destination, event);

      // Register temporary destination
      forwarder.registerDestination(identityDestination.name, identityDestination);
      
      // Process the event
      const result = await forwarder.processEvent(tempEvent);

      // Clean up temporary destination
      forwarder.removeDestination(identityDestination.name);

      // Find the result for our destination
      const destinationResult = result.find(r => r.destination === identityDestination.name);

      if (!destinationResult) {
        return {
          success: false,
          error: 'No response from webhook forwarder'
        };
      }

      // Update destination stats in database
      await this._updateDestinationStats(destination, destinationResult);

      return {
        success: destinationResult.success,
        error: destinationResult.error
      };
    } catch (error) {
      logger.error(`Error sending to destination:`, {
        error: error.message,
        stack: error.stack,
        destinationName: destination.name,
        destinationId: destination.id
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Ensure a destination is registered with the forwarder
   * @private
   * @param {Object} destination - The destination
   * @param {Object} forwarder - The webhook forwarder
   * @returns {Promise<void>}
   */
  async _ensureDestinationRegistered(destination, forwarder) {
    try {
      // Check if already registered
      let isRegistered = false;
      try {
        const destinations = forwarder.getDestinations();
        isRegistered = !!destinations[destination.name];
      } catch (e) {
        isRegistered = false;
      }

      // Register if not already registered
      if (!isRegistered) {
        forwarder.registerDestination(destination.name, {
          url: destination.url,
          method: destination.method || 'POST',
          headers: destination.config.headers || {},
          secret: destination.secretKey,
          enabled: true // Force enable for this request
        });
      }
    } catch (error) {
      logger.error(`Error ensuring destination is registered:`, {
        error: error.message,
        destinationId: destination.id
      });
      // Continue without throwing - not critical
    }
  }

  /**
   * Create a temporary event object for forwarding
   * @private
   * @param {Object} event - The transformed event
   * @returns {Object} - Temporary event object
   */
  _createTempEvent(event) {
    return {
      id: event.id || `temp-${Date.now()}`,
      eventName: event.eventName || 'routed.event',
      timestamp: event.timestamp || new Date(),
      properties: event // Use the transformed event as properties
    };
  }

  /**
   * Create a temporary identity destination
   * @private
   * @param {Object} destination - The destination
   * @param {Object} event - The transformed event
   * @returns {Object} - Temporary identity destination
   */
  _createIdentityDestination(destination, event) {
    return {
      name: `temp_identity_${Date.now()}`,
      url: destination.url,
      method: destination.method || 'POST',
      headers: destination.config.headers || {},
      secret: destination.secretKey,
      transform: () => event // Use pre-transformed event
    };
  }

  /**
   * Update destination stats in the database
   * @private
   * @param {Object} destination - The destination
   * @param {Object} result - The result from forwarding
   * @returns {Promise<void>}
   */
  async _updateDestinationStats(destination, result) {
    try {
      const destinationModel = await Destination.findByPk(destination.id);
      if (destinationModel) {
        if (result.success) {
          await destinationModel.increment('successCount');
          await destinationModel.update({
            lastSent: new Date(),
            lastError: null
          });
        } else {
          await destinationModel.increment('failureCount');
          await destinationModel.update({
            lastError: result.error
          });
        }
      }
    } catch (statsError) {
      logger.error(`Error updating destination stats:`, {
        error: statsError.message,
        destinationId: destination.id
      });
      // Don't fail the operation if we can't update stats
    }
  }
}

// Export a singleton instance
module.exports = new EventRouter();