const asyncHandler = require('express-async-handler');
const Data = require('../models/Data');
const logger = require('../utils/logger');
const { sequelize } = require('../db/connection');
const redisOps = require('../services/redis-failsafe-ops');

/**
 * Create a new data record
 * @route POST /api/data
 */
const createData = asyncHandler(async (req, res) => {
  try {
    const data = await Data.create(req.body);
    
    logger.info(`Created new data record with ID: ${data.id}`, {
      dataId: data.id,
      title: data.title
    });
    
    // Invalidate relevant cache keys using the pattern-based approach
    try {
      await redisOps.invalidatePatterns(['api:/api/data']);
    } catch (cacheError) {
      logger.error(`Error invalidating cache after data creation:`, {
        error: cacheError.message,
        stack: cacheError.stack,
        dataId: data.id
      });
      // Continue despite cache error - the data was created successfully
    }
    
    res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    logger.error(`Error creating data record:`, {
      error: error.message,
      stack: error.stack,
      requestBody: sanitizeForLogging(req.body)
    });
    throw error;
  }
});

/**
 * Create multiple data records in a single transaction
 * @route POST /api/data/batch
 */
const createBatchData = asyncHandler(async (req, res) => {
  // Start a transaction to ensure all entries are created or none
  const transaction = await sequelize.transaction();
  
  try {
    const { entries } = req.body;
    
    const createdEntries = await Data.bulkCreate(entries, { 
      transaction,
      returning: true
    });
    
    // Commit the transaction
    await transaction.commit();
    
    logger.info(`Created ${createdEntries.length} data records in batch`);
    
    // Invalidate relevant cache keys
    try {
      await redisOps.invalidatePatterns(['api:/api/data']);
    } catch (cacheError) {
      logger.error(`Error invalidating cache after batch creation:`, {
        error: cacheError.message,
        stack: cacheError.stack,
        entriesCount: createdEntries.length
      });
      // Continue despite cache error - the data was created successfully
    }
    
    res.status(201).json({
      success: true,
      count: createdEntries.length,
      data: createdEntries
    });
  } catch (error) {
    // Rollback the transaction on error
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error(`Error rolling back transaction:`, {
        error: rollbackError.message,
        stack: rollbackError.stack,
        originalError: error.message
      });
    }
    
    logger.error(`Error creating batch data:`, {
      error: error.message,
      stack: error.stack,
      entriesCount: req.body?.entries?.length
    });
    throw error;
  }
});

/**
 * Get all data records with pagination
 * @route GET /api/data
 */
const getAllData = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    
    // Build query conditions
    const whereClause = {};
    if (status) {
      whereClause.status = status;
    }
    
    // Create cache key based on query parameters
    const cacheKey = `api:/api/data?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`;
    
    // Use getWithFallback for reliable caching
    const result = await redisOps.getWithFallback(
      cacheKey,
      async () => {
        // Query with pagination
        const { count, rows } = await Data.findAndCountAll({
          where: whereClause,
          limit,
          offset,
          order: [['createdAt', 'DESC']]
        });
        
        return {
          success: true,
          count,
          totalPages: Math.ceil(count / limit),
          currentPage: page,
          data: rows
        };
      },
      { ttl: 60 } // Cache for 1 minute
    );
    
    res.json(result);
  } catch (error) {
    logger.error(`Error getting all data:`, {
      error: error.message,
      stack: error.stack,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status
    });
    throw error;
  }
});

/**
 * Get a single data record by ID
 * @route GET /api/data/:id
 */
const getDataById = asyncHandler(async (req, res) => {
  try {
    const id = req.params.id;
    const cacheKey = `api:/api/data/${id}`;
    
    // Use getWithFallback for reliable caching
    const result = await redisOps.getWithFallback(
      cacheKey,
      async () => {
        const data = await Data.findByPk(id);
        
        if (!data) {
          return null; // Let the controller handle the not found case
        }
        
        return {
          success: true,
          data
        };
      },
      { ttl: 300 } // Cache for 5 minutes
    );
    
    // Handle not found case
    if (!result) {
      res.status(404);
      throw new Error('Data record not found');
    }
    
    res.json(result);
  } catch (error) {
    logger.error(`Error getting data by ID:`, {
      error: error.message,
      stack: error.stack,
      dataId: req.params.id
    });
    throw error;
  }
});

/**
 * Update a data record
 * @route PUT /api/data/:id
 */
const updateData = asyncHandler(async (req, res) => {
  try {
    const data = await Data.findByPk(req.params.id);
    
    if (!data) {
      res.status(404);
      throw new Error('Data record not found');
    }
    
    // Update the record
    await data.update(req.body);
    
    logger.info(`Updated data record with ID: ${data.id}`, {
      dataId: data.id,
      title: data.title
    });
    
    // Invalidate both specific and list cache entries
    try {
      await redisOps.invalidatePatterns([
        `api:/api/data/${req.params.id}`,
        'api:/api/data*'
      ]);
    } catch (cacheError) {
      logger.error(`Error invalidating cache after data update:`, {
        error: cacheError.message,
        stack: cacheError.stack,
        dataId: data.id
      });
      // Continue despite cache error - the data was updated successfully
    }
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error(`Error updating data:`, {
      error: error.message,
      stack: error.stack,
      dataId: req.params.id,
      requestBody: sanitizeForLogging(req.body)
    });
    throw error;
  }
});

/**
 * Delete a data record
 * @route DELETE /api/data/:id
 */
const deleteData = asyncHandler(async (req, res) => {
  try {
    const data = await Data.findByPk(req.params.id);
    
    if (!data) {
      res.status(404);
      throw new Error('Data record not found');
    }
    
    await data.destroy();
    
    logger.info(`Deleted data record with ID: ${data.id}`, {
      dataId: data.id,
      title: data.title
    });
    
    // Invalidate both specific and list cache entries
    try {
      await redisOps.invalidatePatterns([
        `api:/api/data/${req.params.id}`,
        'api:/api/data*'
      ]);
    } catch (cacheError) {
      logger.error(`Error invalidating cache after data deletion:`, {
        error: cacheError.message,
        stack: cacheError.stack,
        dataId: req.params.id
      });
      // Continue despite cache error - the data was deleted successfully
    }
    
    res.json({
      success: true,
      message: 'Data record deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting data:`, {
      error: error.message,
      stack: error.stack,
      dataId: req.params.id
    });
    throw error;
  }
});

/**
 * Sanitize sensitive data for logging
 * @private
 * @param {Object} data - Data to sanitize
 * @returns {Object} - Sanitized data
 */
function sanitizeForLogging(data) {
  if (!data) return data;
  
  // Create a deep copy to avoid modifying the original
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // List of fields that should be sanitized
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'key', 'credentials'];
  
  // Function to recursively sanitize fields
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    
    Object.keys(obj).forEach(key => {
      // Check if this is a sensitive field
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        // Recursively sanitize nested objects
        sanitizeObject(obj[key]);
      }
    });
  };
  
  sanitizeObject(sanitized);
  return sanitized;
}

module.exports = {
  createData,
  createBatchData,
  getAllData,
  getDataById,
  updateData,
  deleteData
};