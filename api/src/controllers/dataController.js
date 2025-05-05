const asyncHandler = require('express-async-handler');
const Data = require('../models/Data');
const logger = require('../utils/logger');
const { sequelize } = require('../db/connection');
const redisService = require('../services/redis');
const redisOps = require('../services/redis-failsafe-ops');

/**
 * Create a new data record
 * @route POST /api/data
 */
const createData = asyncHandler(async (req, res) => {
  const data = await Data.create(req.body);
  
  logger.info(`Created new data record with ID: ${data.id}`);
  
  // Invalidate relevant cache keys using the pattern-based approach
  await redisOps.invalidatePatterns(['api:/api/data']);
  
  res.status(201).json({
    success: true,
    data
  });
});

/**
 * Create multiple data records in a single transaction
 * @route POST /api/data/batch
 */
const createBatchData = asyncHandler(async (req, res) => {
  const { entries } = req.body;
  
  // Use a transaction to ensure all entries are created or none
  const result = await sequelize.transaction(async (t) => {
    const createdEntries = await Data.bulkCreate(entries, { 
      transaction: t,
      returning: true
    });
    
    return createdEntries;
  });
  
  logger.info(`Created ${result.length} data records in batch`);
  
  // Invalidate relevant cache keys
  await redisOps.invalidatePatterns(['api:/api/data']);
  
  res.status(201).json({
    success: true,
    count: result.length,
    data: result
  });
});

/**
 * Get all data records with pagination
 * @route GET /api/data
 */
const getAllData = asyncHandler(async (req, res) => {
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
});

/**
 * Get a single data record by ID
 * @route GET /api/data/:id
 */
const getDataById = asyncHandler(async (req, res) => {
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
});

/**
 * Update a data record
 * @route PUT /api/data/:id
 */
const updateData = asyncHandler(async (req, res) => {
  const data = await Data.findByPk(req.params.id);
  
  if (!data) {
    res.status(404);
    throw new Error('Data record not found');
  }
  
  // Update the record
  await data.update(req.body);
  
  logger.info(`Updated data record with ID: ${data.id}`);
  
  // Invalidate both specific and list cache entries
  await redisOps.invalidatePatterns([
    `api:/api/data/${req.params.id}`,
    'api:/api/data*'
  ]);
  
  res.json({
    success: true,
    data
  });
});

/**
 * Delete a data record
 * @route DELETE /api/data/:id
 */
const deleteData = asyncHandler(async (req, res) => {
  const data = await Data.findByPk(req.params.id);
  
  if (!data) {
    res.status(404);
    throw new Error('Data record not found');
  }
  
  await data.destroy();
  
  logger.info(`Deleted data record with ID: ${data.id}`);
  
  // Invalidate both specific and list cache entries
  await redisOps.invalidatePatterns([
    `api:/api/data/${req.params.id}`,
    'api:/api/data*'
  ]);
  
  res.json({
    success: true,
    message: 'Data record deleted successfully'
  });
});

module.exports = {
  createData,
  createBatchData,
  getAllData,
  getDataById,
  updateData,
  deleteData
};