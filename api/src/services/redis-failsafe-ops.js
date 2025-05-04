/**
 * Redis Failsafe Operations
 *
 * This file implements a set of utility functions to extend
 * the Redis service with common caching patterns that handle
 * Redis connection failures gracefully.
 */

const redisService = require('./redis');
const logger = require('../utils/logger');

/**
 * Get data from cache with a fallback to a retrieval function
 * 
 * @param {string} key - Cache key
 * @param {Function} retrieveFunction - Async function to get data if not in cache
 * @param {Object} options - Cache options
 * @param {number} options.ttl - Time to live in seconds
 * @param {boolean} options.forceRefresh - Force refreshing the cache
 * @returns {Promise<any>} - Retrieved data
 */
async function getWithFallback(key, retrieveFunction, options = {}) {
  // Skip cache if forceRefresh is true
  if (!options.forceRefresh) {
    // Try to get from cache first
    const cachedData = await redisService.get(key);
    
    if (cachedData) {
      return cachedData;
    }
  }
  
  // Not in cache or forced refresh, retrieve fresh data
  const freshData = await retrieveFunction();
  
  // Store in cache if we have data (don't await)
  if (freshData && redisService.isRedisConnected()) {
    redisService.set(key, freshData, { ttl: options.ttl || 300 })
      .catch(err => logger.error(`Failed to cache data for key ${key}:`, err));
  }
  
  return freshData;
}

/**
 * Batch operation with caching
 * 
 * @param {Array<string>} keys - Array of cache keys
 * @param {Function} batchRetrieveFunction - Function to retrieve all missing items
 * @param {Function} keyExtractor - Function to extract key from an item
 * @param {Object} options - Cache options
 * @returns {Promise<Array>} - Array of retrieved items
 */
async function batchGetWithFallback(keys, batchRetrieveFunction, keyExtractor, options = {}) {
  const result = [];
  const missingKeys = [];
  const keyToIndexMap = {};
  
  // Build a map of keys to their position in the result array
  keys.forEach((key, index) => {
    keyToIndexMap[key] = index;
    // Initialize result array with nulls
    result[index] = null;
  });
  
  // Try to get items from cache
  if (redisService.isRedisConnected()) {
    const client = redisService.getClient();
    
    try {
      // Get multiple keys at once
      const cachedItems = await Promise.all(
        keys.map(key => redisService.get(key))
      );
      
      // Process cached items
      cachedItems.forEach((item, index) => {
        const key = keys[index];
        
        if (item) {
          // Item found in cache
          result[index] = item;
        } else {
          // Item not in cache, need to retrieve
          missingKeys.push(key);
        }
      });
    } catch (error) {
      logger.error('Error in batch get operation:', error);
      // On error, consider all keys as missing
      missingKeys.push(...keys);
    }
  } else {
    // Redis not connected, all keys are missing
    missingKeys.push(...keys);
  }
  
  // If we have missing keys, retrieve them
  if (missingKeys.length > 0) {
    try {
      const freshItems = await batchRetrieveFunction(missingKeys);
      
      // Process and cache fresh items
      for (const item of freshItems) {
        const key = keyExtractor(item);
        const index = keyToIndexMap[key];
        
        if (index !== undefined) {
          result[index] = item;
          
          // Cache the item (don't await)
          if (redisService.isRedisConnected()) {
            redisService.set(key, item, { ttl: options.ttl || 300 })
              .catch(err => logger.error(`Failed to cache batch item for key ${key}:`, err));
          }
        }
      }
    } catch (error) {
      logger.error('Error retrieving batch items:', error);
    }
  }
  
  return result;
}

/**
 * Invalidate multiple cache entries based on a pattern
 * 
 * @param {Array<string>} patterns - Array of patterns to invalidate
 * @returns {Promise<number>} - Number of invalidated keys
 */
async function invalidatePatterns(patterns) {
  if (!redisService.isRedisConnected()) {
    return 0;
  }
  
  try {
    let totalDeleted = 0;
    
    for (const pattern of patterns) {
      const deleted = await redisService.deleteByPattern(pattern);
      totalDeleted += deleted;
    }
    
    return totalDeleted;
  } catch (error) {
    logger.error('Error invalidating cache patterns:', error);
    return 0;
  }
}

/**
 * Cache the response of an API call with automatic invalidation setup
 * 
 * @param {Function} fn - The function to cache
 * @param {Object} options - Caching options
 * @param {string} options.keyPrefix - Prefix for cache keys
 * @param {number} options.ttl - Cache TTL in seconds
 * @param {Array<string>} options.invalidationPatterns - Patterns to invalidate on mutation
 * @returns {Object} - Object with wrapped function and invalidation function
 */
function createCachedApi(fn, options = {}) {
  const keyPrefix = options.keyPrefix || 'api:';
  const ttl = options.ttl || 300;
  const invalidationPatterns = options.invalidationPatterns || [];
  
  // Create a function that builds a cache key from arguments
  const buildKey = (args) => {
    // Create a deterministic string from the arguments
    const argsStr = JSON.stringify(args);
    const hash = require('crypto')
      .createHash('md5')
      .update(argsStr)
      .digest('hex');
    
    return `${keyPrefix}:${hash}`;
  };
  
  // Wrapped function with caching
  const cachedFn = async (...args) => {
    const cacheKey = buildKey(args);
    
    return getWithFallback(
      cacheKey,
      () => fn(...args),
      { ttl }
    );
  };
  
  // Function to invalidate the cache
  const invalidateCache = async () => {
    return invalidatePatterns(invalidationPatterns);
  };
  
  return {
    fn: cachedFn,
    invalidate: invalidateCache
  };
}

module.exports = {
  getWithFallback,
  batchGetWithFallback,
  invalidatePatterns,
  createCachedApi
};