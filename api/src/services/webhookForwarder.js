const logger = require('../utils/logger');
const fetch = require('node-fetch');
const crypto = require('crypto');
const transformerService = require('./transformerService');

/**
 * WebhookForwarder Service
 * A lightweight service to forward events to external services
 * with powerful generic transformation capabilities
 */
class WebhookForwarder {
  constructor() {
    // Map of destinations: { "destinationName": { url, eventTypes, transform, headers } }
    this.destinations = {};
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
   * @throws {Error} If required parameters are missing
   */
  registerDestination(name, config) {
    if (!name || !config.url) {
      throw new Error('Destination name and URL are required');
    }

    // Normalize eventTypes to array
    const eventTypes = config.eventTypes === '*' 
      ? '*' 
      : (Array.isArray(config.eventTypes) ? config.eventTypes : [config.eventTypes]);
    
    // Handle transform configuration
    let transformFn;
    
    if (typeof config.transform === 'function') {
      // Direct function - use as is
      transformFn = config.transform;
    } else if (config.transform && typeof config.transform === 'object') {
      // Configuration object - use transformer service to create the function
      transformFn = transformerService.createTransformer(config.transform);
    } else {
      // No transform specified - use identity transform
      transformFn = transformerService.createTransformer('identity');
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
   * Process an event and forward it to matching destinations
   * @param {Object} event - The event to process
   * @returns {Promise<Array>} - Results of the forwarding operations
   */
  async processEvent(event) {
    try {
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
    } catch (error) {
      logger.error('Unexpected error in processEvent:', {
        error: error.message,
        stack: error.stack,
        eventName: event?.eventName
      });
      return [];
    }
  }

  /**
   * Send an event to a specific destination
   * @private
   * @param {string} name - Destination name
   * @param {Object} config - Destination configuration
   * @param {Object} event - Event to send
   * @returns {Promise<Object>} - Result of the send operation
   * @throws {Error} If the webhook request fails
   */
  async _sendToDestination(name, config, event) {
    try {
      logger.debug(`Forwarding event ${event.eventName} to ${name}`);
      
      // Transform the event according to destination requirements
      const payload = await transformerService.safeTransform(
        config.transform, 
        event, 
        `destination:${name}`
      );
      
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
      const body = await this._prepareRequestBody(payload, headers);
      
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
      
      // Parse response data
      const responseData = await this._parseResponseData(response);
      
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
   * Prepare request body based on content type
   * @private
   * @param {Object} payload - The payload to send
   * @param {Object} headers - Request headers
   * @returns {string|URLSearchParams|FormData} - Prepared request body
   */
  async _prepareRequestBody(payload, headers) {
    const contentType = headers['Content-Type']?.toLowerCase() || 'application/json';
    
    try {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Convert payload to URL-encoded form data
        const body = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
          if (typeof value === 'object') {
            body.append(key, JSON.stringify(value));
          } else {
            body.append(key, String(value));
          }
        });
        return body;
      } else if (contentType.includes('multipart/form-data')) {
        // Use FormData for multipart requests
        const body = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (typeof value === 'object') {
            body.append(key, JSON.stringify(value));
          } else {
            body.append(key, String(value));
          }
        });
        return body;
      } else {
        // Default to JSON
        return JSON.stringify(payload);
      }
    } catch (error) {
      logger.error('Error preparing request body:', error);
      throw new Error(`Failed to prepare request body: ${error.message}`);
    }
  }
  
  /**
   * Parse response data, handling both JSON and text
   * @private
   * @param {Response} response - Fetch response object
   * @returns {Object|string} - Parsed response data
   */
  async _parseResponseData(response) {
    try {
      return await response.json();
    } catch (error) {
      // If JSON parsing fails, return as text
      return await response.text();
    }
  }
  
  /**
   * Generate a signature for the payload
   * @private
   * @param {Object} payload - The payload to sign
   * @param {string} secret - Secret key
   * @returns {string} - The signature
   */
  _generateSignature(payload, secret) {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return hmac.digest('hex');
    } catch (error) {
      logger.error('Error generating signature:', error);
      throw new Error(`Failed to generate signature: ${error.message}`);
    }
  }
}

// Export singleton instance
module.exports = new WebhookForwarder();