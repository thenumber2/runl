const asyncHandler = require('express-async-handler');
const Event = require('../models/Event');
const logger = require('../utils/logger');
const { getRedisClient } = require('../services/redis');
const { sequelize } = require('../db/connection');

/**
 * Log a new event
 * @route POST /api/events
 */
const logEvent = asyncHandler(async (req, res) => {
  const { eventName, timestamp, properties } = req.body;
  
  try {
    // Create event entry
    const event = await Event.create({
      eventName,
      timestamp: new Date(timestamp),
      properties
    });
    
    logger.info(`Logged new event: ${eventName}, ID: ${event.id}`);
    
    // Invalidate relevant cache keys
    const redisClient = getRedisClient();
    if (redisClient?.isOpen) {
      await redisClient.del('api:/api/events');
    }
    
    res.status(201).json({
      success: true,
      data: event
    });
  } catch (error) {
    logger.error(`Error logging event: ${error.message}`, { error });
    res.status(500).json({
      success: false,
      message: 'Error logging event',
      error: error.message
    });
  }
});

/**
 * Get events with pagination and filtering
 * @route GET /api/events
 */
const getEvents = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const eventName = req.query.eventName;
  const userId = req.query.userId;
  
  // Build query conditions
  const whereClause = {};
  if (eventName) {
    whereClause.eventName = eventName;
  }
  
  // Add userId filter if provided
  if (userId) {
    whereClause[sequelize.Op.and] = sequelize.literal(
      `properties->>'userId' = '${userId}'`
    );
  }
  
  // Query with pagination
  const { count, rows } = await Event.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [['timestamp', 'DESC']]
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
 * Get a single event by ID
 * @route GET /api/events/:id
 */
const getEventById = asyncHandler(async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  
  if (!event) {
    res.status(404);
    throw new Error('Event not found');
  }
  
  res.json({
    success: true,
    data: event
  });
});

/**
 * Get all events for a specific user
 * @route GET /api/events/user/:userId
 */
const getEventsByUserId = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const userId = req.params.userId;
  
  // Use raw query to filter by userId in JSONB
  const { count, rows } = await Event.findAndCountAll({
    where: sequelize.literal(`properties->>'userId' = '${userId}'`),
    limit,
    offset,
    order: [['timestamp', 'DESC']]
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
 * Search events by property value
 * @route GET /api/events/search
 */
const searchEvents = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;
  const { key, value } = req.query;
  
  if (!key || !value) {
    res.status(400);
    throw new Error('Search key and value are required');
  }
  
  // Use JSONB querying
  const { count, rows } = await Event.findAndCountAll({
    where: sequelize.literal(`properties->>'${key}' = '${value}'`),
    limit,
    offset,
    order: [['timestamp', 'DESC']]
  });
  
  res.json({
    success: true,
    count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    data: rows
  });
});

module.exports = {
  logEvent,
  getEvents,
  getEventById,
  getEventsByUserId,
  searchEvents
};