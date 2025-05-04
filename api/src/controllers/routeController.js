const asyncHandler = require('express-async-handler');
const Route = require('../models/Route');
const Transformation = require('../models/Transformation');
const Destination = require('../models/Destination');
const logger = require('../utils/logger');
const eventRouter = require('../services/eventRouter');
const { sequelize } = require('../db/connection');

/**
 * Create a new route
 * @route POST /api/routes
 */
const createRoute = asyncHandler(async (req, res) => {
  // Start a transaction
  const transaction = await sequelize.transaction();
  
  try {
    const routeData = req.body;
    
    // Check if route with this name already exists
    const existingRoute = await Route.findOne({
      where: { name: routeData.name },
      transaction
    });
    
    if (existingRoute) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Route with name "${routeData.name}" already exists`);
    }
    
    // Verify the transformation exists and is enabled
    const transformation = await Transformation.findByPk(routeData.transformationId, {
      transaction
    });
    
    if (!transformation) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Transformation with ID "${routeData.transformationId}" not found`);
    }
    
    if (!transformation.enabled) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Transformation "${transformation.name}" is currently disabled`);
    }
    
    // Verify the destination exists and is enabled
    const destination = await Destination.findByPk(routeData.destinationId, {
      transaction
    });
    
    if (!destination) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Destination with ID "${routeData.destinationId}" not found`);
    }
    
    if (!destination.enabled) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Destination "${destination.name}" is currently disabled`);
    }
    
    // Create the route
    const route = await Route.create(routeData, { transaction });
    
    // Commit the transaction
    await transaction.commit();
    
    logger.info(`Created new route: ${route.name}`, {
      routeId: route.id,
      transformationId: route.transformationId,
      destinationId: route.destinationId
    });
    
    // Refresh the router cache
    try {
      await eventRouter.refreshRoutes();
    } catch (refreshError) {
      logger.error(`Error refreshing routes after creation:`, {
        error: refreshError.message,
        stack: refreshError.stack,
        routeId: route.id
      });
      // Continue despite refresh error - the route was created successfully
    }
    
    res.status(201).json({
      success: true,
      data: route
    });
  } catch (error) {
    // Make sure to rollback the transaction on error
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error(`Error rolling back transaction:`, {
          error: rollbackError.message,
          stack: rollbackError.stack,
          originalError: error.message
        });
      }
    }
    
    logger.error(`Error creating route:`, {
      error: error.message,
      stack: error.stack,
      routeName: req.body?.name,
      transformationId: req.body?.transformationId,
      destinationId: req.body?.destinationId
    });
    
    throw error; // Let asyncHandler handle the error response
  }
});

/**
 * Get all routes
 * @route GET /api/routes
 */
const getRoutes = asyncHandler(async (req, res) => {
  try {
    // Apply filters if provided
    const whereClause = {};
    
    if (req.query.enabled !== undefined) {
      whereClause.enabled = req.query.enabled === 'true';
    }
    
    // Get all routes with their transformations and destinations
    const routes = await Route.findAll({
      where: whereClause,
      include: [
        {
          model: Transformation,
          as: 'transformation',
          attributes: ['id', 'name', 'type', 'enabled']
        },
        {
          model: Destination,
          as: 'destination',
          attributes: ['id', 'name', 'type', 'url', 'enabled']
        }
      ],
      order: [
        ['priority', 'ASC'],
        ['createdAt', 'DESC']
      ]
    });
    
    res.json({
      success: true,
      count: routes.length,
      data: routes
    });
  } catch (error) {
    logger.error(`Error getting routes:`, {
      error: error.message,
      stack: error.stack,
      filters: req.query
    });
    throw error;
  }
});

/**
 * Get a specific route by ID
 * @route GET /api/routes/:id
 */
const getRouteById = asyncHandler(async (req, res) => {
  try {
    const route = await Route.findByPk(req.params.id, {
      include: [
        {
          model: Transformation,
          as: 'transformation'
        },
        {
          model: Destination,
          as: 'destination'
        }
      ]
    });
    
    if (!route) {
      res.status(404);
      throw new Error('Route not found');
    }
    
    res.json({
      success: true,
      data: route
    });
  } catch (error) {
    logger.error(`Error getting route by ID:`, {
      error: error.message,
      stack: error.stack,
      routeId: req.params.id
    });
    throw error;
  }
});

/**
 * Update a route
 * @route PUT /api/routes/:id
 */
const updateRoute = asyncHandler(async (req, res) => {
  // Start a transaction
  const transaction = await sequelize.transaction();
  
  try {
    const route = await Route.findByPk(req.params.id, { transaction });
    
    if (!route) {
      await transaction.rollback();
      res.status(404);
      throw new Error('Route not found');
    }
    
    // Check if name is being changed and already exists
    if (req.body.name && req.body.name !== route.name) {
      const existingRoute = await Route.findOne({
        where: { name: req.body.name },
        transaction
      });
      
      if (existingRoute) {
        await transaction.rollback();
        res.status(400);
        throw new Error(`Route with name "${req.body.name}" already exists`);
      }
    }
    
    // If transformation is being changed, verify it exists and is enabled
    if (req.body.transformationId && req.body.transformationId !== route.transformationId) {
      const transformation = await Transformation.findByPk(req.body.transformationId, {
        transaction
      });
      
      if (!transformation) {
        await transaction.rollback();
        res.status(400);
        throw new Error(`Transformation with ID "${req.body.transformationId}" not found`);
      }
      
      if (!transformation.enabled) {
        await transaction.rollback();
        res.status(400);
        throw new Error(`Transformation "${transformation.name}" is currently disabled`);
      }
    }
    
    // If destination is being changed, verify it exists and is enabled
    if (req.body.destinationId && req.body.destinationId !== route.destinationId) {
      const destination = await Destination.findByPk(req.body.destinationId, {
        transaction
      });
      
      if (!destination) {
        await transaction.rollback();
        res.status(400);
        throw new Error(`Destination with ID "${req.body.destinationId}" not found`);
      }
      
      if (!destination.enabled) {
        await transaction.rollback();
        res.status(400);
        throw new Error(`Destination "${destination.name}" is currently disabled`);
      }
    }
    
    // Update route
    await route.update(req.body, { transaction });
    
    // Commit the transaction
    await transaction.commit();
    
    logger.info(`Updated route: ${route.name}`, {
      routeId: route.id
    });
    
    // Refresh the router cache
    try {
      await eventRouter.refreshRoutes();
    } catch (refreshError) {
      logger.error(`Error refreshing routes after update:`, {
        error: refreshError.message,
        stack: refreshError.stack,
        routeId: route.id
      });
      // Continue despite refresh error - the route was updated successfully
    }
    
    // Fetch the updated route with associations
    const updatedRoute = await Route.findByPk(route.id, {
      include: [
        {
          model: Transformation,
          as: 'transformation',
          attributes: ['id', 'name', 'type', 'enabled']
        },
        {
          model: Destination,
          as: 'destination',
          attributes: ['id', 'name', 'type', 'url', 'enabled']
        }
      ]
    });
    
    res.json({
      success: true,
      data: updatedRoute
    });
  } catch (error) {
    // Make sure to rollback the transaction on error
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        logger.error(`Error rolling back transaction:`, {
          error: rollbackError.message,
          stack: rollbackError.stack,
          originalError: error.message
        });
      }
    }
    
    logger.error(`Error updating route:`, {
      error: error.message,
      stack: error.stack,
      routeId: req.params.id
    });
    
    throw error; // Let asyncHandler handle the error response
  }
});

/**
 * Delete a route
 * @route DELETE /api/routes/:id
 */
const deleteRoute = asyncHandler(async (req, res) => {
  try {
    const route = await Route.findByPk(req.params.id);
    
    if (!route) {
      res.status(404);
      throw new Error('Route not found');
    }
    
    // Delete the route
    await route.destroy();
    
    logger.info(`Deleted route: ${route.name}`, {
      routeId: route.id
    });
    
    // Refresh the router cache
    try {
      await eventRouter.refreshRoutes();
    } catch (refreshError) {
      logger.error(`Error refreshing routes after deletion:`, {
        error: refreshError.message,
        stack: refreshError.stack,
        routeId: req.params.id
      });
      // Continue despite refresh error - the route was deleted successfully
    }
    
    res.json({
      success: true,
      message: 'Route deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting route:`, {
      error: error.message,
      stack: error.stack,
      routeId: req.params.id
    });
    throw error;
  }
});

/**
 * Enable or disable a route
 * @route PATCH /api/routes/:id/toggle
 */
const toggleRoute = asyncHandler(async (req, res) => {
  try {
    const route = await Route.findByPk(req.params.id);
    
    if (!route) {
      res.status(404);
      throw new Error('Route not found');
    }
    
    // Toggle enabled status
    const newStatus = !route.enabled;
    
    await route.update({
      enabled: newStatus
    });
    
    logger.info(`${newStatus ? 'Enabled' : 'Disabled'} route: ${route.name}`, {
      routeId: route.id
    });
    
    // Refresh the router cache
    try {
      await eventRouter.refreshRoutes();
    } catch (refreshError) {
      logger.error(`Error refreshing routes after toggle:`, {
        error: refreshError.message,
        stack: refreshError.stack,
        routeId: route.id
      });
      // Continue despite refresh error - the route was toggled successfully
    }
    
    res.json({
      success: true,
      data: route
    });
  } catch (error) {
    logger.error(`Error toggling route:`, {
      error: error.message,
      stack: error.stack,
      routeId: req.params.id
    });
    throw error;
  }
});

/**
 * Test a route with a sample event
 * @route POST /api/routes/:id/test
 */
const testRoute = asyncHandler(async (req, res) => {
  try {
    const route = await Route.findByPk(req.params.id, {
      include: [
        {
          model: Transformation,
          as: 'transformation'
        },
        {
          model: Destination,
          as: 'destination'
        }
      ]
    });
    
    if (!route) {
      res.status(404);
      throw new Error('Route not found');
    }
    
    // Create a test event based on provided data or defaults
    const testEvent = {
      id: 'test-' + Date.now(),
      eventName: req.query.eventName || 'test.event',
      timestamp: new Date(),
      properties: req.body || {
        test: true,
        message: 'This is a test event'
      }
    };
    
    // First, check if route matches this event
    const matches = await doesRouteMatchEvent(route, testEvent);
    
    if (!matches) {
      return res.json({
        success: true,
        matches: false,
        message: 'Route does not match this event',
        reason: 'Event type or condition does not match'
      });
    }
    
    // Next, apply the transformation
    const transformationResult = await applyTransformation(
      testEvent, 
      route.transformation
    );
    
    // Finally, test sending to destination (dry run)
    const sendResult = await testSendToDestination(
      transformationResult,
      route.destination
    );
    
    res.json({
      success: true,
      matches: true,
      originalEvent: testEvent,
      transformedData: transformationResult,
      destination: {
        name: route.destination.name,
        url: route.destination.url,
        would_succeed: sendResult.success,
        details: sendResult.details
      }
    });
  } catch (error) {
    logger.error(`Error testing route:`, {
      error: error.message,
      stack: error.stack,
      routeId: req.params.id
    });
    
    res.status(400).json({
      success: false,
      message: 'Error testing route',
      error: error.message
    });
  }
});

/**
 * Check if a route matches an event
 * @private
 * @param {Object} route - The route to check
 * @param {Object} event - The event to check against
 * @returns {Promise<boolean>} - Whether the route matches the event
 */
async function doesRouteMatchEvent(route, event) {
  try {
    // Check if event name matches any of the route's event types
    const eventNameMatches = eventNameMatchesRoute(event.eventName, route.eventTypes);
    
    if (!eventNameMatches) {
      return false;
    }
    
    // Check if there are additional conditions
    if (route.condition) {
      // This would need to implement the same condition checking logic
      // that's in the eventRouter service
      return true; // Simplification for now
    }
    
    return true;
  } catch (error) {
    logger.error(`Error checking if route matches event:`, {
      error: error.message,
      stack: error.stack,
      routeId: route.id,
      eventName: event.eventName
    });
    return false; // Fail safely
  }
}

/**
 * Check if an event name matches the route's event types
 * @private
 * @param {string} eventName - The event name to check
 * @param {Array<string>} routeEventTypes - The route's event types
 * @returns {boolean} - Whether the event name matches
 */
function eventNameMatchesRoute(eventName, routeEventTypes) {
  try {
    // Handle wildcard
    if (routeEventTypes.includes('*')) {
      return true;
    }
    
    // Check if event name is in the list
    if (routeEventTypes.includes(eventName)) {
      return true;
    }
    
    // Check for pattern matches (with *)
    for (const pattern of routeEventTypes) {
      if (typeof pattern !== 'string' || !pattern.includes('*')) {
        continue;
      }
      
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      
      const regex = new RegExp(`^${regexPattern}$`);
      
      if (regex.test(eventName)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    logger.error(`Error matching event name to route:`, {
      error: error.message,
      stack: error.stack,
      eventName,
      routeEventTypes
    });
    return false; // Fail safely
  }
}

/**
 * Apply a transformation to an event
 * @private
 * @param {Object} event - The event to transform
 * @param {Object} transformation - The transformation to apply
 * @returns {Promise<Object>} - The transformed data
 */
async function applyTransformation(event, transformation) {
  try {
    const webhookForwarder = require('../services/webhookForwarder');
    
    // Create a fake destination with this transformation
    const testDestination = {
      name: `test_${Date.now()}`,
      url: 'https://example.com/webhook', // Won't be used
      transform: transformation.config,
      type: transformation.type
    };
    
    // Register with webhook forwarder
    webhookForwarder.registerDestination(testDestination.name, testDestination);
    
    // Use internal method to get transformed data without actually sending
    const transformFn = webhookForwarder.getDestinations()[testDestination.name].transform;
    const transformed = await webhookForwarder._safeTransform(
      transformFn, 
      event, 
      testDestination.name
    );
    
    // Clean up
    webhookForwarder.removeDestination(testDestination.name);
    
    return transformed;
  } catch (error) {
    logger.error(`Error applying transformation:`, {
      error: error.message,
      stack: error.stack,
      transformationId: transformation.id
    });
    throw error;
  }
}

/**
 * Test sending to a destination without actually sending
 * @private
 * @param {Object} data - The data to send
 * @param {Object} destination - The destination to test
 * @returns {Promise<Object>} - The result
 */
async function testSendToDestination(data, destination) {
  try {
    // This is a mock function to avoid actually sending data
    // In a real implementation, you might do more validation
    
    const isValidUrl = destination.url && 
      (destination.url.startsWith('http://') || 
       destination.url.startsWith('https://'));
       
    return {
      success: isValidUrl,
      details: isValidUrl 
        ? 'Connection would be attempted to: ' + destination.url
        : 'Invalid destination URL'
    };
  } catch (error) {
    logger.error(`Error testing send to destination:`, {
      error: error.message,
      stack: error.stack,
      destinationId: destination.id
    });
    
    return {
      success: false,
      details: `Error: ${error.message}`
    };
  }
}

module.exports = {
  createRoute,
  getRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
  toggleRoute,
  testRoute
};