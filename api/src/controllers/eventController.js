const asyncHandler = require('express-async-handler');
const Event = require('../models/Event');
const logger = require('../utils/logger');
const redisService = require('../services/redis');
const { sequelize } = require('../db/connection');
const webhookForwarder = require('../services/webhookForwarder');

// Import WebSocket service
const websocketService = require('../services/websocketService');

/**
 * Log a new event
 * @route POST /api/events
 */
const logEvent = asyncHandler(async (req, res) => {
  // Start a transaction to ensure atomic event logging
  const transaction = await sequelize.transaction();
  
  try {
    const { eventName, timestamp, properties } = req.body;
    
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
      await forwardEventToDestinations(event);
    } catch (forwardError) {
      // Log but don't fail the request if forwarding fails
      logger.error(`Error forwarding event: ${forwardError.message}`, {
        error: forwardError.message,
        stack: forwardError.stack,
        eventId: event.id,
        eventName
      });
    }
    
    // Broadcast the event to all connected WebSocket clients
    try {
      const broadcastCount = await websocketService.broadcastEvent(event);
      logger.debug(`Broadcasted event to ${broadcastCount} WebSocket clients`, {
        eventId: event.id,
        eventName
      });
    } catch (wsError) {
      // Log but don't fail the request if WebSocket broadcasting fails
      logger.error(`Error broadcasting event to WebSocket clients: ${wsError.message}`, {
        error: wsError.message,
        stack: wsError.stack,
        eventId: event.id,
        eventName
      });
    }
    
    // Invalidate relevant cache keys
    try {
      await invalidateEventCache();
    } catch (cacheError) {
      // Log but don't fail if cache invalidation fails
      logger.error(`Error invalidating event cache: ${cacheError.message}`, {
        error: cacheError.message,
        eventId: event.id
      });
    }
    
    res.status(201).json({
      success: true,
      data: event
    });
  } catch (error) {
    // Rollback the transaction on error
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error(`Error rolling back transaction: ${rollbackError.message}`, {
        originalError: error.message
      });
    }
    
    logger.error(`Error logging event: ${error.message}`, { 
      error: error.message,
      stack: error.stack,
      eventName: req.body?.eventName
    });
    
    throw error;
  }
});

/**
 * Forward an event to configured destinations
 * @private
 * @param {Object} event - The event to forward
 * @returns {Promise<Array>} - Results of forwarding
 */
async function forwardEventToDestinations(event) {
  try {
    // Check if webhookForwarder is properly initialized
    if (!webhookForwarder || typeof webhookForwarder.processEvent !== 'function') {
      logger.warn('Event forwarding skipped - webhookForwarder not properly initialized', {
        eventId: event.id,
        eventName: event.eventName,
        webhookForwarderType: typeof webhookForwarder
      });
      return [];
    }
    
    // Process the event through the webhook forwarder
    const forwardResults = await webhookForwarder.processEvent(event);
    
    if (forwardResults && forwardResults.length > 0) {
      logger.debug(`Event forwarded to ${forwardResults.length} destinations`, {
        eventId: event.id,
        eventName: event.eventName,
        successCount: forwardResults.filter(r => r.success).length,
        failureCount: forwardResults.filter(r => !r.success).length
      });
    }
    
    return forwardResults;
  } catch (error) {
    logger.error(`Error in forwardEventToDestinations: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      eventId: event.id,
      eventName: event.eventName
    });
    throw error;
  }
}

/**
 * Invalidate event-related cache entries
 * @private
 * @returns {Promise<void>}
 */
async function invalidateEventCache() {
  try {
    if (redisService.isRedisConnected()) {
      await redisService.deleteByPattern('api:/api/events*');
    }
  } catch (error) {
    logger.error(`Error invalidating event cache: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get events with pagination and filtering
 * @route GET /api/events
 */
const getEvents = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const eventName = req.query.eventName;
    const userId = req.query.userId;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    
    // Build query conditions
    const whereClause = {};
    if (eventName) {
      whereClause.eventName = eventName;
    }
    
    // Add date range filter
    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) {
        whereClause.timestamp[sequelize.Op.gte] = startDate;
      }
      if (endDate) {
        whereClause.timestamp[sequelize.Op.lte] = endDate;
      }
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
  } catch (error) {
    logger.error(`Error getting events: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      filters: req.query
    });
    throw error;
  }
});

/**
 * Get a single event by ID
 * @route GET /api/events/:id
 */
const getEventById = asyncHandler(async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    
    if (!event) {
      res.status(404);
      throw new Error('Event not found');
    }
    
    res.json({
      success: true,
      data: event
    });
  } catch (error) {
    logger.error(`Error getting event by ID: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      eventId: req.params.id
    });
    throw error;
  }
});

/**
 * Get all events for a specific user
 * @route GET /api/events/user/:userId
 */
const getEventsByUserId = asyncHandler(async (req, res) => {
  try {
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
  } catch (error) {
    logger.error(`Error getting events by user ID: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      userId: req.params.userId
    });
    throw error;
  }
});

/**
 * Search events by property value
 * @route GET /api/events/search
 */
const searchEvents = asyncHandler(async (req, res) => {
  try {
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
  } catch (error) {
    logger.error(`Error searching events: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      searchKey: req.query.key,
      searchValue: req.query.value
    });
    throw error;
  }
});

/**
 * Replay an event through webhook forwarder
 * @route POST /api/events/:id/forward
 */
const forwardEvent = asyncHandler(async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id);
    
    if (!event) {
      res.status(404);
      throw new Error('Event not found');
    }
    
    // Optionally limit to specific destinations
    const destinationNames = req.body.destinations;
    
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
    
    // When manually forwarding an event, also broadcast to WebSocket clients
    try {
      await websocketService.broadcastEvent(event);
    } catch (wsError) {
      logger.warn(`Error broadcasting manually forwarded event to WebSocket clients: ${wsError.message}`, {
        error: wsError.message,
        eventId: event.id
      });
      // Continue despite WebSocket error
    }
    
    res.json({
      success: true,
      message: `Event forwarded to ${results.length} destinations`,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      results: results
    });
  } catch (error) {
    logger.error(`Error forwarding event: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      eventId: req.params.id
    });
    
    // Custom error response for this specific endpoint
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