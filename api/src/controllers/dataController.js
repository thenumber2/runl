const asyncHandler = require('express-async-handler');
const Data = require('../models/Data');
const logger = require('../utils/logger');
const { sequelize } = require('../db/connection');
const { getRedisClient } = require('../services/redis');

/**
 * Create a new data record
 * @route POST /api/data
 */
const createData = asyncHandler(async (req, res) => {
  const data = await Data.create(req.body);
  
  logger.info(`Created new data record with ID: ${data.id}`);
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del('api:/api/data');
  }
  
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
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del('api:/api/data');
  }
  
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
  
  // Query with pagination
  const { count, rows } = await Data.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['createdAt', 'DESC']]
  });
  
  res.json({
    success: true,
    count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    data: rows
  });
});

/**
 * Get a single data record by ID
 * @route GET /api/data/:id
 */
const getDataById = asyncHandler(async (req, res) => {
  const data = await Data.findByPk(req.params.id);
  
  if (!data) {
    res.status(404);
    throw new Error('Data record not found');
  }
  
  res.json({
    success: true,
    data
  });
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
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del(`api:/api/data/${req.params.id}`);
    await redisClient.del('api:/api/data');
  }
  
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
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del(`api:/api/data/${req.params.id}`);
    await redisClient.del('api:/api/data');
  }
  
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