/**
 * Redis Failsafe Operations
 *
 * This file implements a set of utility functions to extend
 * the Redis service with common caching patterns that handle
 * Redis connection failures gracefully.
 */

const redisService = require('./redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

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
  try {
    // Skip cache if forceRefresh is true or cache is not connected
    if (!options.forceRefresh && redisService.isRedisConnected()) {
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
        .catch(err => logger.error(`Failed to cache data for key ${key}:`, {
          error: err.message,
          stack: err.stack
        }));
    }
    
    return freshData;
  } catch (error) {
    logger.error(`Error in getWithFallback for key ${key}:`, {
      error: error.message,
      stack: error.stack
    });
    
    // If cache retrieval fails, fall back to direct retrieval
    try {
      return await retrieveFunction();
    } catch (retrievalError) {
      logger.error(`Retrieval function also failed for key ${key}:`, {
        error: retrievalError.message,
        stack: retrievalError.stack
      });
      throw retrievalError; // Let the caller handle this error
    }
  }
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
  try {
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
        logger.error('Error in batch get operation:', {
          error: error.message,
          stack: error.stack
        });
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
                .catch(err => logger.error(`Failed to cache batch item for key ${key}:`, {
                  error: err.message,
                  stack: err.stack
                }));
            }
          }
        }
      } catch (error) {
        logger.error('Error retrieving batch items:', {
          error: error.message,
          stack: error.stack,
          missingKeyCount: missingKeys.length
        });
        
        // Re-throw the error for the caller to handle
        throw error;
      }
    }
    
    return result;
  } catch (error) {
    logger.error('Unhandled error in batchGetWithFallback:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Invalidate multiple cache entries based on a pattern
 * 
 * @param {Array<string>} patterns - Array of patterns to invalidate
 * @returns {Promise<number>} - Number of invalidated keys
 */
async function invalidatePatterns(patterns) {
  try {
    if (!redisService.isRedisConnected()) {
      return 0;
    }
    
    let totalDeleted = 0;
    
    for (const pattern of patterns) {
      try {
        const deleted = await redisService.deleteByPattern(pattern);
        totalDeleted += deleted;
      } catch (patternError) {
        logger.error(`Error invalidating pattern ${pattern}:`, {
          error: patternError.message,
          stack: patternError.stack
        });
        // Continue with other patterns
      }
    }
    
    return totalDeleted;
  } catch (error) {
    logger.error('Error invalidating cache patterns:', {
      error: error.message,
      stack: error.stack,
      patterns: patterns
    });
    return 0;
  }
}

/**
 * Build a deterministic cache key from arguments
 * @private
 * @param {string} prefix - Key prefix
 * @param {Array} args - Arguments to include in the key
 * @returns {string} - Cache key
 */
function _buildCacheKey(prefix, args) {
  try {
    // Create a deterministic string from the arguments
    const argsStr = JSON.stringify(args);
    const hash = crypto
      .createHash('md5')
      .update(argsStr)
      .digest('hex');
    
    return `${prefix}:${hash}`;
  } catch (error) {
    logger.error('Error building cache key:', {
      error: error.message,
      stack: error.stack
    });
    // Fallback to a timestamp-based key if hashing fails
    return `${prefix}:fallback-${Date.now()}`;
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
  
  // Wrapped function with caching
  const cachedFn = async (...args) => {
    try {
      const cacheKey = _buildCacheKey(keyPrefix, args);
      
      return await getWithFallback(
        cacheKey,
        () => fn(...args),
        { ttl }
      );
    } catch (error) {
      logger.error('Error in cached API function:', {
        error: error.message,
        stack: error.stack,
        keyPrefix
      });
      // Fall back to direct function call on error
      return fn(...args);
    }
  };
  
  // Function to invalidate the cache
  const invalidateCache = async () => {
    try {
      return await invalidatePatterns(invalidationPatterns);
    } catch (error) {
      logger.error('Error invalidating cached API:', {
        error: error.message,
        stack: error.stack,
        patterns: invalidationPatterns
      });
      return 0;
    }
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