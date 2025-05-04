const asyncHandler = require('express-async-handler');
const Destination = require('../models/Destination');
const logger = require('../utils/logger');
const webhookForwarder = require('../services/webhookForwarder');

/**
 * Create a new webhook destination
 * @route POST /api/destinations
 */
const createDestination = asyncHandler(async (req, res) => {
  const destinationData = req.body;
  
  // Check if a destination with this name already exists
  const existingDestination = await Destination.findOne({
    where: { name: destinationData.name }
  });
  
  if (existingDestination) {
    res.status(400);
    throw new Error(`Destination with name "${destinationData.name}" already exists`);
  }
  
  // Create the destination in the database
  const destination = await Destination.create(destinationData);
  
  logger.info(`Created new webhook destination: ${destination.name}`, {
    destinationId: destination.id,
    type: destination.type
  });
  
  // Register with the webhook forwarder service
  try {
    await registerWithForwarder(destination);
    
    res.status(201).json({
      success: true,
      data: sanitizeDestination(destination),
      registered: true
    });
  } catch (error) {
    logger.error(`Failed to register destination with webhook forwarder:`, {
      error: error.message,
      stack: error.stack,
      destinationId: destination.id
    });
    
    res.status(201).json({
      success: true,
      data: sanitizeDestination(destination),
      registered: false,
      registerError: error.message
    });
  }
});

/**
 * Get all webhook destinations
 * @route GET /api/destinations
 */
const getDestinations = asyncHandler(async (req, res) => {
  // Filter conditions
  const whereClause = {};
  
  // Filter by type if specified
  if (req.query.type) {
    whereClause.type = req.query.type;
  }
  
  // Filter by enabled status if specified
  if (req.query.enabled !== undefined) {
    whereClause.enabled = req.query.enabled === 'true';
  }
  
  // Get all destinations
  const destinations = await Destination.findAll({
    where: whereClause,
    order: [['createdAt', 'DESC']]
  });
  
  res.json({
    success: true,
    count: destinations.length,
    data: destinations.map(sanitizeDestination)
  });
});

/**
 * Get a webhook destination by ID
 * @route GET /api/destinations/:id
 */
const getDestinationById = asyncHandler(async (req, res) => {
  const destination = await Destination.findByPk(req.params.id);
  
  if (!destination) {
    res.status(404);
    throw new Error('Destination not found');
  }
  
  res.json({
    success: true,
    data: sanitizeDestination(destination)
  });
});

/**
 * Update a webhook destination
 * @route PUT /api/destinations/:id
 */
const updateDestination = asyncHandler(async (req, res) => {
  const destination = await Destination.findByPk(req.params.id);
  
  if (!destination) {
    res.status(404);
    throw new Error('Destination not found');
  }
  
  // Check if name is being changed and already exists
  if (req.body.name && req.body.name !== destination.name) {
    const existingDestination = await Destination.findOne({
      where: { name: req.body.name }
    });
    
    if (existingDestination) {
      res.status(400);
      throw new Error(`Destination with name "${req.body.name}" already exists`);
    }
  }
  
  // Update destination
  await destination.update(req.body);
  
  logger.info(`Updated webhook destination: ${destination.name}`, {
    destinationId: destination.id
  });
  
  // Re-register with webhook forwarder
  try {
    // First remove if it exists
    webhookForwarder.removeDestination(destination.name);
    
    // Then re-register
    await registerWithForwarder(destination);
    
    res.json({
      success: true,
      data: sanitizeDestination(destination),
      registered: true
    });
  } catch (error) {
    logger.error(`Failed to update destination in webhook forwarder:`, {
      error: error.message,
      stack: error.stack,
      destinationId: destination.id
    });
    
    res.json({
      success: true,
      data: sanitizeDestination(destination),
      registered: false,
      registerError: error.message
    });
  }
});

/**
 * Delete a webhook destination
 * @route DELETE /api/destinations/:id
 */
const deleteDestination = asyncHandler(async (req, res) => {
  const destination = await Destination.findByPk(req.params.id);
  
  if (!destination) {
    res.status(404);
    throw new Error('Destination not found');
  }
  
  // First remove from webhookForwarder
  try {
    webhookForwarder.removeDestination(destination.name);
  } catch (error) {
    logger.error(`Error removing destination from webhook forwarder:`, {
      error: error.message,
      destinationId: destination.id
    });
    // Continue with deletion even if this fails
  }
  
  // Then delete from database
  await destination.destroy();
  
  logger.info(`Deleted webhook destination: ${destination.name}`, {
    destinationId: destination.id
  });
  
  res.json({
    success: true,
    message: 'Destination deleted successfully'
  });
});

/**
 * Enable or disable a webhook destination
 * @route PATCH /api/destinations/:id/toggle
 */
const toggleDestination = asyncHandler(async (req, res) => {
  const destination = await Destination.findByPk(req.params.id);
  
  if (!destination) {
    res.status(404);
    throw new Error('Destination not found');
  }
  
  // Toggle enabled status
  const newStatus = !destination.enabled;
  
  await destination.update({
    enabled: newStatus
  });
  
  logger.info(`${newStatus ? 'Enabled' : 'Disabled'} destination: ${destination.name}`, {
    destinationId: destination.id
  });
  
  // Update status in webhook forwarder
  try {
    webhookForwarder.setDestinationStatus(destination.name, newStatus);
  } catch (error) {
    logger.error(`Error updating destination status in webhook forwarder:`, {
      error: error.message,
      destinationId: destination.id
    });
  }
  
  res.json({
    success: true,
    data: sanitizeDestination(destination)
  });
});

/**
 * Test a webhook destination by sending a test event
 * @route POST /api/destinations/:id/test
 */
const testDestination = asyncHandler(async (req, res) => {
  const destination = await Destination.findByPk(req.params.id);
  
  if (!destination) {
    res.status(404);
    throw new Error('Destination not found');
  }
  
  // Create a test event
  const testEvent = {
    id: 'test-' + Date.now(),
    eventName: 'test.event',
    timestamp: new Date(),
    properties: {
      test: true,
      message: 'This is a test event',
      ...req.body
    }
  };
  
  try {
    // Temporarily register the destination if it's not currently registered
    let wasRegisteredAlready = true;
    try {
      const destinations = webhookForwarder.getDestinations();
      wasRegisteredAlready = !!destinations[destination.name];
    } catch (e) {
      wasRegisteredAlready = false;
    }
    
    if (!wasRegisteredAlready) {
      await registerWithForwarder(destination, true); // Force enable for test
    }
    
    // Process the test event
    const result = await webhookForwarder.processEvent(testEvent);
    
    // If the destination wasn't registered and we enabled it just for testing,
    // restore its original state
    if (!wasRegisteredAlready && !destination.enabled) {
      webhookForwarder.setDestinationStatus(destination.name, false);
    }
    
    // Update success/failure counts based on test result
    const testResult = result.find(r => r.destination === destination.name);
    
    if (testResult) {
      if (testResult.success) {
        await destination.increment('successCount');
        await destination.update({
          lastSent: new Date(),
          lastError: null
        });
      } else {
        await destination.increment('failureCount');
        await destination.update({
          lastError: testResult.error
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Test event sent',
      result: testResult || { 
        destination: destination.name, 
        success: false, 
        error: 'No response from webhook forwarder' 
      }
    });
  } catch (error) {
    logger.error(`Error testing destination:`, {
      error: error.message,
      stack: error.stack,
      destinationId: destination.id
    });
    
    await destination.increment('failureCount');
    await destination.update({
      lastError: error.message
    });
    
    res.status(500).json({
      success: false,
      message: 'Error testing destination',
      error: error.message
    });
  }
});

/**
 * Get destination statistics
 * @route GET /api/destinations/stats
 */
const getDestinationStats = asyncHandler(async (req, res) => {
  // Get counts by type - using proper Sequelize aggregation
  const typeCounts = await Destination.findAll({
    attributes: [
      'type',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['type']
  });
  
  // Get enabled/disabled counts - using proper Sequelize aggregation
  const statusCounts = await Destination.findAll({
    attributes: [
      'enabled',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['enabled']
  });
  
  // Get total success/failure counts
  const totalSuccesses = await Destination.sum('successCount');
  const totalFailures = await Destination.sum('failureCount');
  
  // Get destinations with recent errors
  const recentFailures = await Destination.findAll({
    where: {
      lastError: {
        [sequelize.Op.not]: null
      }
    },
    order: [['updatedAt', 'DESC']],
    limit: 5
  });
  
  // Get most active destinations
  const mostActive = await Destination.findAll({
    order: [['successCount', 'DESC']],
    limit: 5
  });
  
  res.json({
    success: true,
    stats: {
      byType: typeCounts,
      byStatus: statusCounts,
      totalSuccesses: totalSuccesses || 0,
      totalFailures: totalFailures || 0,
      recentFailures: recentFailures.map(sanitizeDestination),
      mostActive: mostActive.map(sanitizeDestination)
    }
  });
});

/**
 * Register a destination with the webhook forwarder service
 * @private
 * @param {Object} destination - Destination object from database
 * @param {boolean} forceEnable - Whether to force enable the destination
 * @returns {Object} - The registered destination config
 */
async function registerWithForwarder(destination, forceEnable = false) {
  // Skip registration if disabled and not forced
  if (!destination.enabled && !forceEnable) {
    return null;
  }
  
  // Get the decrypted secret if it exists
  const secret = destination.getDecryptedSecret();
  
  // Create the transform configuration
  let transform;
  
  // Register with webhook forwarder
  return webhookForwarder.registerDestination(destination.name, {
    url: destination.url,
    method: destination.method || 'POST',
    eventTypes: destination.eventTypes,
    transform,
    headers: destination.config.headers || {},
    secret: secret, // Use the decrypted secret
    enabled: destination.enabled || forceEnable,
    timeout: destination.timeout || 5000
  });
}

/**
 * Remove sensitive data from destination object
 * @private
 * @param {Object} destination - Destination object
 * @returns {Object} - Sanitized destination
 */
function sanitizeDestination(destination) {
  const sanitized = destination.toJSON ? destination.toJSON() : { ...destination };
  
  // Remove the secret key from the response
  if (sanitized.secretKey) {
    sanitized.hasSecret = true;
    delete sanitized.secretKey;
  } else {
    sanitized.hasSecret = false;
  }
  
  return sanitized;
}

/**
 * Load all destinations from the database and register them with the webhook forwarder
 * This should be called during application startup
 */
const loadDestinationsFromDatabase = async () => {
  try {
    // Get all enabled destinations
    const destinations = await Destination.findAll({
      where: { enabled: true }
    });
    
    logger.info(`Loading ${destinations.length} webhook destinations from database`);
    
    // Register each destination
    for (const destination of destinations) {
      try {
        await registerWithForwarder(destination);
      } catch (error) {
        logger.error(`Failed to register destination ${destination.id} during startup:`, {
          error: error.message,
          stack: error.stack,
          destinationName: destination.name
        });
      }
    }
    
    logger.info('Finished loading webhook destinations');
  } catch (error) {
    logger.error('Error loading webhook destinations from database:', {
      error: error.message,
      stack: error.stack
    });
  }
};

module.exports = {
  createDestination,
  getDestinations,
  getDestinationById,
  updateDestination,
  deleteDestination,
  toggleDestination,
  testDestination,
  getDestinationStats,
  loadDestinationsFromDatabase
};