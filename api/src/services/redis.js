const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient;

// Setup Redis client
const setupRedis = async () => {
  try {
    const url = `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`;
    
    redisClient = createClient({
      url
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    await redisClient.connect();
    logger.info('Redis connected successfully');
    
    return redisClient;
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

// Cache middleware
const cacheMiddleware = (duration) => {
  return async (req, res, next) => {
    if (!redisClient?.isOpen) {
      return next();
    }

    const key = `api:${req.originalUrl}`;
    
    try {
      const cachedData = await redisClient.get(key);
      
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }
      
      // Store the original res.json function
      const originalJson = res.json;
      
      // Override res.json to cache the response before sending
      res.json = function(data) {
        if (res.statusCode === 200) {
          redisClient.set(key, JSON.stringify(data), {
            EX: duration
          });
        }
        return originalJson.call(this, data);
      };
      
      next();
    } catch (error) {
      logger.error('Redis cache error:', error);
      next();
    }
  };
};

module.exports = {
  setupRedis,
  cacheMiddleware,
  getRedisClient: () => redisClient
};