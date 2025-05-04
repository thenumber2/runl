const { createClient } = require('redis');
const logger = require('../utils/logger');

/**
 * Redis Service
 * 
 * A centralized service for managing Redis connections and operations
 * with improved error handling, connection management, and simplified APIs.
 */
class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connecting = false;
    this.options = {};
    this.connectionAttempts = 0;
    this.maxReconnectAttempts = 10;
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
    if (this.isConnected) {
      return this;
    }
    
    if (this.connecting) {
      logger.debug('Redis connection already in progress');
      return this;
    }
    
    this.connecting = true;
    this.connectionAttempts = 0;
    
    try {
      const host = this.options.host || process.env.REDIS_HOST || 'redis';
      const port = this.options.port || process.env.REDIS_PORT || 6379;
      const url = `redis://${host}:${port}`;
      
      logger.info(`Connecting to Redis at ${host}:${port}`);
      
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

      // Set up event handlers
      this.client.on('error', this._handleError.bind(this));
      this.client.on('connect', this._handleConnect.bind(this));
      this.client.on('reconnecting', this._handleReconnecting.bind(this));
      this.client.on('ready', this._handleReady.bind(this));
      this.client.on('end', this._handleEnd.bind(this));

      await this.client.connect();
      this.isConnected = true;
      this.connecting = false;
      logger.info('Redis connected successfully');
      
      return this;
    } catch (error) {
      this.isConnected = false;
      this.connecting = false;
      logger.error('Failed to connect to Redis:', error);
      
      if (this.client) {
        try {
          await this.client.quit();
        } catch (quitError) {
          logger.debug('Error while quitting Redis client:', quitError);
        }
        this.client = null;
      }
      
      // Allow application to continue without Redis
      logger.warn('Application running without Redis caching');
      return this;
    }
  }

  /**
   * Get the Redis client instance
   * @returns {Object|null} - Redis client or null if not connected
   */
  getClient() {
    return this.isConnected && this.client ? this.client : null;
  }

  /**
   * Check if Redis is connected
   * @returns {boolean} - Connection status
   */
  isRedisConnected() {
    return this.isConnected;
  }

  /**
   * Gracefully close the Redis connection
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client && this.client.isOpen) {
      try {
        await this.client.quit();
        logger.info('Redis disconnected successfully');
      } catch (error) {
        logger.error('Error disconnecting from Redis:', error);
      }
    }
    
    this.isConnected = false;
    this.client = null;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} - Cached value or null if not found
   */
  async get(key) {
    if (!this.isConnected || !this.client?.isOpen) {
      return null;
    }
    
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Redis get error for key ${key}:`, error);
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
    if (!this.isConnected || !this.client?.isOpen) {
      return false;
    }
    
    try {
      const setOptions = {};
      
      if (options.ttl) {
        setOptions.EX = options.ttl;
      }
      
      await this.client.set(key, JSON.stringify(value), setOptions);
      return true;
    } catch (error) {
      logger.error(`Redis set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a key from cache
   * @param {string|string[]} key - Key or array of keys to delete
   * @returns {Promise<boolean>} - Success status
   */
  async del(key) {
    if (!this.isConnected || !this.client?.isOpen) {
      return false;
    }
    
    try {
      if (Array.isArray(key)) {
        await this.client.del(key);
      } else {
        await this.client.del(key);
      }
      return true;
    } catch (error) {
      logger.error(`Redis delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete keys by pattern
   * @param {string} pattern - Key pattern to match (e.g. "user:*")
   * @returns {Promise<number>} - Number of keys deleted
   */
  async deleteByPattern(pattern) {
    if (!this.isConnected || !this.client?.isOpen) {
      return 0;
    }
    
    try {
      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) {
        return 0;
      }
      
      await this.client.del(keys);
      logger.debug(`Deleted ${keys.length} keys matching pattern: ${pattern}`);
      return keys.length;
    } catch (error) {
      logger.error(`Redis deleteByPattern error for ${pattern}:`, error);
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
      // Skip caching if Redis isn't connected
      if (!this.isConnected || !this.client?.isOpen) {
        return next();
      }

      const key = `api:${req.originalUrl}`;
      
      try {
        const cachedData = await this.get(key);
        
        if (cachedData) {
          logger.debug(`Cache hit for: ${key}`);
          return res.json(cachedData);
        }
        
        logger.debug(`Cache miss for: ${key}`);
        
        // Store the original res.json function
        const originalJson = res.json;
        
        // Override res.json to cache the response before sending
        res.json = function(data) {
          if (res.statusCode === 200) {
            // Don't wait for the cache to be set
            this.set(key, data, { ttl: duration })
              .catch(err => {
                logger.error(`Failed to set cache for ${key}:`, err);
              });
          }
          return originalJson.call(this, data);
        }.bind(this);
        
        next();
      } catch (error) {
        logger.error('Redis cache middleware error:', error);
        // Continue without caching
        next();
      }
    };
  }

  // Private event handlers
  _handleError(err) {
    this.isConnected = false;
    logger.error('Redis Client Error:', err);
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