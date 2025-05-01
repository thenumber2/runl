const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient;
let redisConnected = false;

// Setup Redis client
const setupRedis = async () => {
  try {
    const host = process.env.REDIS_HOST || 'redis';
    const port = process.env.REDIS_PORT || 6379;
    const url = `redis://${host}:${port}`;
    
    logger.info(`Connecting to Redis at ${host}:${port}`);
    
    redisClient = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          // Exponential backoff with max delay of 10 seconds
          const delay = Math.min(Math.pow(2, retries) * 100, 10000);
          logger.info(`Redis reconnect attempt ${retries}, retrying in ${delay}ms`);
          return delay;
        }
      }
    });

    // Event handlers
    redisClient.on('error', (err) => {
      redisConnected = false;
      logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });

    redisClient.on('ready', () => {
      redisConnected = true;
      logger.info('Redis client ready');
    });

    await redisClient.connect();
    logger.info('Redis connected successfully');
    redisConnected = true;
    
    return redisClient;
  } catch (error) {
    redisConnected = false;
    logger.error('Failed to connect to Redis:', error);
    
    // Don't throw the error - allow the application to continue
    // We'll operate in degraded mode (without caching)
    logger.warn('Application running without Redis caching');
    return null;
  }
};

// Cache middleware with better error handling
const cacheMiddleware = (duration) => {
  return async (req, res, next) => {
    // Skip caching if Redis isn't connected
    if (!redisClient?.isOpen || !redisConnected) {
      return next();
    }

    const key = `api:${req.originalUrl}`;
    
    try {
      const cachedData = await redisClient.get(key);
      
      if (cachedData) {
        logger.debug(`Cache hit for: ${key}`);
        return res.json(JSON.parse(cachedData));
      }
      
      logger.debug(`Cache miss for: ${key}`);
      
      // Store the original res.json function
      const originalJson = res.json;
      
      // Override res.json to cache the response before sending
      res.json = function(data) {
        if (res.statusCode === 200) {
          // Don't wait for the cache to be set
          redisClient.set(key, JSON.stringify(data), {
            EX: duration
          }).catch(err => {
            logger.error(`Failed to set cache for ${key}:`, err);
          });
        }
        return originalJson.call(this, data);
      };
      
      next();
    } catch (error) {
      logger.error('Redis cache error:', error);
      // Continue without caching
      next();
    }
  };
};

// Function to clear cache by pattern
const clearCacheByPattern = async (pattern) => {
  if (!redisClient?.isOpen || !redisConnected) {
    return false;
  }
  
  try {
    // Get keys matching pattern
    const keys = await redisClient.keys(`api:${pattern}`);
    
    if (keys.length > 0) {
      // Delete all matched keys
      await redisClient.del(keys);
      logger.info(`Cleared ${keys.length} cache entries matching: ${pattern}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to clear cache for pattern ${pattern}:`, error);
    return false;
  }
};

module.exports = {
  setupRedis,
  cacheMiddleware,
  clearCacheByPattern,
  getRedisClient: () => redisClient,
  isRedisConnected: () => redisConnected
};