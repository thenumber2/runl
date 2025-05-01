const asyncHandler = require('express-async-handler');
const DataEntry = require('../models/DataEntry');
const logger = require('../utils/logger');
const { sequelize } = require('../db/connection');
const { getRedisClient } = require('../services/redis');

/**
 * Create a new data entry
 * @route POST /api/data
 */
const createDataEntry = asyncHandler(async (req, res) => {
  const dataEntry = await DataEntry.create(req.body);
  
  logger.info(`Created new data entry with ID: ${dataEntry.id}`);
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del('api:/api/data');
  }
  
  res.status(201).json({
    success: true,
    data: dataEntry
  });
});

/**
 * Create multiple data entries in a single transaction
 * @route POST /api/data/batch
 */
const createBatchDataEntries = asyncHandler(async (req, res) => {
  const { entries } = req.body;
  
  // Use a transaction to ensure all entries are created or none
  const result = await sequelize.transaction(async (t) => {
    const createdEntries = await DataEntry.bulkCreate(entries, { 
      transaction: t,
      returning: true
    });
    
    return createdEntries;
  });
  
  logger.info(`Created ${result.length} data entries in batch`);
  
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
 * Get all data entries with pagination
 * @route GET /api/data
 */
const getDataEntries = asyncHandler(async (req, res) => {
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
  const { count, rows } = await DataEntry.findAndCountAll({
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
 * Get a single data entry by ID
 * @route GET /api/data/:id
 */
const getDataEntryById = asyncHandler(async (req, res) => {
  const dataEntry = await DataEntry.findByPk(req.params.id);
  
  if (!dataEntry) {
    res.status(404);
    throw new Error('Data entry not found');
  }
  
  res.json({
    success: true,
    data: dataEntry
  });
});

/**
 * Update a data entry
 * @route PUT /api/data/:id
 */
const updateDataEntry = asyncHandler(async (req, res) => {
  const dataEntry = await DataEntry.findByPk(req.params.id);
  
  if (!dataEntry) {
    res.status(404);
    throw new Error('Data entry not found');
  }
  
  // Update the entry
  await dataEntry.update(req.body);
  
  logger.info(`Updated data entry with ID: ${dataEntry.id}`);
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del(`api:/api/data/${req.params.id}`);
    await redisClient.del('api:/api/data');
  }
  
  res.json({
    success: true,
    data: dataEntry
  });
});

/**
 * Delete a data entry
 * @route DELETE /api/data/:id
 */
const deleteDataEntry = asyncHandler(async (req, res) => {
  const dataEntry = await DataEntry.findByPk(req.params.id);
  
  if (!dataEntry) {
    res.status(404);
    throw new Error('Data entry not found');
  }
  
  await dataEntry.destroy();
  
  logger.info(`Deleted data entry with ID: ${dataEntry.id}`);
  
  // Invalidate relevant cache keys
  const redisClient = getRedisClient();
  if (redisClient?.isOpen) {
    await redisClient.del(`api:/api/data/${req.params.id}`);
    await redisClient.del('api:/api/data');
  }
  
  res.json({
    success: true,
    message: 'Data entry deleted successfully'
  });
});

module.exports = {
  createDataEntry,
  createBatchDataEntries,
  getDataEntries,
  getDataEntryById,
  updateDataEntry,
  deleteDataEntry
};