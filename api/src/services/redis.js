const { createClient } = require('redis');
const logger = require('../utils/logger');

/**
 * Redis Service
 * 
 * A centralized service for managing Redis connections and operations
 * with improved error handling, connection management, and simplified APIs.
 * Fixed to prevent memory leaks from event listeners.
 */
class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connecting = false;
    this.options = {};
    this.connectionAttempts = 0;
    this.maxReconnectAttempts = 10;
    
    // Bind event handlers once in the constructor to maintain reference consistency
    this._boundHandleError = this._handleError.bind(this);
    this._boundHandleConnect = this._handleConnect.bind(this);
    this._boundHandleReconnecting = this._handleReconnecting.bind(this);
    this._boundHandleReady = this._handleReady.bind(this);
    this._boundHandleEnd = this._handleEnd.bind(this);
  }

  /**
   * Initialize the Redis service with configuration
   * @param {Object} options - Redis connection options
   * @returns {RedisService} - Instance for chaining
   */
  configure(options = {}) {
    this.options = {
      host: process.env.REDIS_HOST || 'redis',
      port: process.env.REDIS_PORT || 6379,
      maxReconnectAttempts: 10,
      initialBackoff: 100,
      maxBackoff: 10000,
      ...options
    };
    
    this.maxReconnectAttempts = this.options.maxReconnectAttempts;
    
    return this;
  }

  /**
   * Connect to Redis server
   * @returns {Promise<RedisService>} - Redis service instance
   */
  async connect() {
    try {
      if (this.isConnected) {
        return this;
      }
      
      if (this.connecting) {
        logger.debug('Redis connection already in progress');
        return this;
      }
      
      this.connecting = true;
      this.connectionAttempts = 0;
      
      const host = this.options.host || process.env.REDIS_HOST || 'redis';
      const port = this.options.port || process.env.REDIS_PORT || 6379;
      const url = `redis://${host}:${port}`;
      
      logger.info(`Connecting to Redis at ${host}:${port}`);
      
      // Clean up existing client if it exists
      await this._cleanupExistingClient();
      
      this.client = createClient({
        url,
        socket: {
          reconnectStrategy: (retries) => {
            this.connectionAttempts = retries;
            
            if (retries >= this.maxReconnectAttempts) {
              logger.error(`Maximum Redis reconnection attempts (${this.maxReconnectAttempts}) reached`);
              return new Error('Maximum reconnection attempts reached');
            }
            
            // Exponential backoff with max delay
            const delay = Math.min(
              Math.pow(2, retries) * this.options.initialBackoff, 
              this.options.maxBackoff
            );
            
            logger.info(`Redis reconnect attempt ${retries}, retrying in ${delay}ms`);
            return delay;
          }
        }
      });

      // Set up event handlers using bound methods from constructor
      this._attachEventListeners();

      await this.client.connect();
      this.isConnected = true;
      this.connecting = false;
      logger.info('Redis connected successfully');
      
      return this;
    } catch (error) {
      this.isConnected = false;
      this.connecting = false;
      logger.error('Failed to connect to Redis:', {
        error: error.message,
        stack: error.stack,
        host: this.options.host,
        port: this.options.port
      });
      
      await this._cleanupExistingClient();
      
      // Allow application to continue without Redis
      logger.warn('Application running without Redis caching');
      return this;
    }
  }
  
  /**
   * Attach event listeners to the Redis client
   * @private
   */
  _attachEventListeners() {
    if (!this.client) return;
    
    this.client.on('error', this._boundHandleError);
    this.client.on('connect', this._boundHandleConnect);
    this.client.on('reconnecting', this._boundHandleReconnecting);
    this.client.on('ready', this._boundHandleReady);
    this.client.on('end', this._boundHandleEnd);
  }
  
  /**
   * Remove event listeners from the Redis client
   * @private
   */
  _removeEventListeners() {
    if (!this.client) return;
    
    this.client.removeListener('error', this._boundHandleError);
    this.client.removeListener('connect', this._boundHandleConnect);
    this.client.removeListener('reconnecting', this._boundHandleReconnecting);
    this.client.removeListener('ready', this._boundHandleReady);
    this.client.removeListener('end', this._boundHandleEnd);
  }
  
  /**
   * Clean up existing Redis client
   * @private
   * @returns {Promise<void>}
   */
  async _cleanupExistingClient() {
    if (this.client) {
      try {
        // Remove all event listeners to prevent memory leaks
        this._removeEventListeners();
        
        // Quit if the connection is still open
        if (this.client.isOpen) {
          await this.client.quit();
        }
      } catch (quitError) {
        logger.debug('Error while cleaning up Redis client:', quitError);
      }
      this.client = null;
    }
  }

  /**
   * Get the Redis client instance
   * @returns {Object|null} - Redis client or null if not connected
   */
  getClient() {
    return this.isRedisConnected() && this.client ? this.client : null;
  }

  /**
   * Check if Redis is connected
   * @returns {boolean} - Connection status
   */
  isRedisConnected() {
    return this.isConnected && this.client?.isOpen;
  }

  /**
   * Gracefully close the Redis connection
   * @returns {Promise<void>}
   */
  async disconnect() {
    try {
      await this._cleanupExistingClient();
      this.isConnected = false;
      logger.info('Redis disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', {
        error: error.message,
        stack: error.stack
      });
      
      // Force cleanup even on error
      this.isConnected = false;
      this.client = null;
    }
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null if not found
   */
  async get(key) {
    try {
      if (!this.isRedisConnected()) {
        return null;
      }
      
      const data = await this.client.get(key);
      
      if (!data) {
        return null;
      }
      
      try {
        return JSON.parse(data);
      } catch (parseError) {
        // If parsing fails, return the raw string
        logger.debug(`Redis parse error for key ${key}, returning raw string:`, parseError);
        return data;
      }
    } catch (error) {
      logger.error(`Redis get error for key ${key}:`, {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to store
   * @param {Object} options - Storage options
   * @param {number} options.ttl - Time to live in seconds
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, options = {}) {
    try {
      if (!this.isRedisConnected()) {
        return false;
      }
      
      const setOptions = {};
      
      if (options.ttl) {
        setOptions.EX = options.ttl;
      }
      
      // Handle different value types
      const valueToStore = typeof value === 'string' 
        ? value 
        : JSON.stringify(value);
      
      await this.client.set(key, valueToStore, setOptions);
      return true;
    } catch (error) {
      logger.error(`Redis set error for key ${key}:`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Delete a key from cache
   * @param {string|string[]} key - Key or array of keys to delete
   * @returns {Promise<boolean>} - Success status
   */
  async del(key) {
    try {
      if (!this.isRedisConnected()) {
        return false;
      }
      
      if (Array.isArray(key)) {
        await this.client.del(key);
      } else {
        await this.client.del(key);
      }
      return true;
    } catch (error) {
      logger.error(`Redis delete error for key ${Array.isArray(key) ? 'multiple keys' : key}:`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Delete keys by pattern
   * @param {string} pattern - Key pattern to match (e.g. "user:*")
   * @returns {Promise<number>} - Number of keys deleted
   */
  async deleteByPattern(pattern) {
    try {
      if (!this.isRedisConnected()) {
        return 0;
      }
      
      const keys = await this.client.keys(pattern);
      
      if (!keys || keys.length === 0) {
        return 0;
      }
      
      await this.client.del(keys);
      logger.debug(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
      return keys.length;
    } catch (error) {
      logger.error(`Redis deleteByPattern error for ${pattern}:`, {
        error: error.message,
        stack: error.stack
      });
      return 0;
    }
  }

  /**
   * Create a middleware for caching HTTP responses
   * @param {number} duration - Cache duration in seconds
   * @returns {Function} - Express middleware
   */
  cacheMiddleware(duration = 60) {
    return async (req, res, next) => {
      try {
        // Skip caching if Redis isn't connected
        if (!this.isRedisConnected()) {
          return next();
        }

        const key = `api:${req.originalUrl}`;
        
        // Attempt to get from cache
        const cachedData = await this.get(key);
        
        if (cachedData) {
          logger.debug(`Cache hit for: ${key}`);
          return res.json(cachedData);
        }
        
        logger.debug(`Cache miss for: ${key}`);
        
        // Store the original res.json function
        const originalJson = res.json;
        
        // Override res.json to cache the response before sending
        res.json = (data) => {
          if (res.statusCode === 200) {
            // Don't wait for the cache to be set
            this.set(key, data, { ttl: duration })
              .catch(err => {
                logger.error(`Failed to set cache for ${key}:`, {
                  error: err.message,
                  stack: err.stack
                });
              });
          }
          return originalJson.call(res, data);
        };
        
        next();
      } catch (error) {
        logger.error('Redis cache middleware error:', {
          error: error.message,
          stack: error.stack,
          url: req.originalUrl
        });
        // Continue without caching
        next();
      }
    };
  }

  // Private event handlers
  _handleError(err) {
    this.isConnected = false;
    logger.error('Redis Client Error:', {
      error: err.message,
      stack: err.stack
    });
  }

  _handleConnect() {
    logger.info('Redis client connected');
  }

  _handleReconnecting() {
    logger.info('Redis client reconnecting');
  }

  _handleReady() {
    this.isConnected = true;
    logger.info('Redis client ready');
  }

  _handleEnd() {
    this.isConnected = false;
    logger.info('Redis connection closed');
  }
}

// Export a singleton instance
module.exports = new RedisService();