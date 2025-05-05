const asyncHandler = require('express-async-handler');
const Event = require('../models/Event');
const logger = require('../utils/logger');
const { getRedisClient } = require('../services/redis');
const { sequelize } = require('../db/connection');
const webhookForwarder = require('../services/webhookForwarder');

/**
 * Log a new event
 * @route POST /api/events
 */
const logEvent = asyncHandler(async (req, res) => {
  const { eventName, timestamp, properties } = req.body;
  
  try {
    // Start a transaction to ensure atomic event logging
    const transaction = await sequelize.transaction();
    
    try {
      // Create event entry
      const event = await Event.create({
        eventName,
        timestamp: new Date(timestamp),
        properties
      }, { transaction });
      
      logger.info(`Logged new event: ${eventName}, ID: ${event.id}`);
      
      // Commit the transaction first to ensure the event is saved
      await transaction.commit();
      
      // After the event is safely saved, forward it to any configured destinations
      // This is intentionally done after the transaction commits
      // to ensure the event is recorded regardless of forwarding success
      try {
        // Check if webhookForwarder is properly initialized
        if (webhookForwarder && typeof webhookForwarder.processEvent === 'function') {
          // Process the event through the webhook forwarder
          const forwardResults = await webhookForwarder.processEvent(event);
          
          if (forwardResults && forwardResults.length > 0) {
            logger.debug(`Event forwarded to ${forwardResults.length} destinations`, {
              eventId: event.id,
              eventName,
              successCount: forwardResults.filter(r => r.success).length,
              failureCount: forwardResults.filter(r => !r.success).length
            });
          }
        } else {
          logger.warn('Event forwarding skipped - webhookForwarder not properly initialized', {
            eventId: event.id,
            eventName,
            webhookForwarderType: typeof webhookForwarder
          });
        }
      } catch (forwardError) {
        // Log but don't fail the request if forwarding fails
        logger.error(`Error forwarding event: ${forwardError.message}`, {
          error: forwardError,
          eventId: event.id,
          eventName
        });
      }
      
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
      // Rollback the transaction on error
      await transaction.rollback();
      throw error;
    }
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
  
  // Add userId filter if provided - using parameterized query
  if (userId) {
    whereClause[sequelize.Op.and] = sequelize.where(
      sequelize.json('properties.userId'),
      '=',
      userId
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
  
  // Using parameterized query instead of literal SQL
  const { count, rows } = await Event.findAndCountAll({
    where: sequelize.where(
      sequelize.json('properties.userId'),
      '=',
      userId
    ),
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
  
  // Using parameterized JSONB query instead of literal SQL
  const { count, rows } = await Event.findAndCountAll({
    where: sequelize.where(
      sequelize.json(`properties.${key}`),
      '=',
      value
    ),
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
 * Replay an event through webhook forwarder
 * @route POST /api/events/:id/forward
 */
const forwardEvent = asyncHandler(async (req, res) => {
  const event = await Event.findByPk(req.params.id);
  
  if (!event) {
    res.status(404);
    throw new Error('Event not found');
  }
  
  // Optionally limit to specific destinations
  const destinationNames = req.body.destinations;
  
  try {
    // Process the event through webhook forwarder
    const forwardResults = await webhookForwarder.processEvent(event);
    
    // Filter results to requested destinations if specified
    const results = destinationNames
      ? forwardResults.filter(r => destinationNames.includes(r.destination))
      : forwardResults;
    
    logger.info(`Manually forwarded event: ${event.eventName}`, {
      eventId: event.id,
      destinationsCount: results.length,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length
    });
    
    res.json({
      success: true,
      message: `Event forwarded to ${results.length} destinations`,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      results: results
    });
  } catch (error) {
    logger.error(`Error forwarding event: ${error.message}`, {
      error,
      eventId: event.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Error forwarding event',
      error: error.message
    });
  }
});

module.exports = {
  logEvent,
  getEvents,
  getEventById,
  getEventsByUserId,
  searchEvents,
  forwardEvent
};