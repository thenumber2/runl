const asyncHandler = require('express-async-handler');
const Transformation = require('../models/Transformation');
const Route = require('../models/Route');
const logger = require('../utils/logger');
const eventRouter = require('../services/eventRouter');
const { sequelize } = require('../db/connection');

/**
 * Create a new transformation
 * @route POST /api/transformations
 */
const createTransformation = asyncHandler(async (req, res) => {
  const transformationData = req.body;
  
  // Check if transformation with this name already exists
  const existingTransformation = await Transformation.findOne({
    where: { name: transformationData.name }
  });
  
  if (existingTransformation) {
    res.status(400);
    throw new Error(`Transformation with name "${transformationData.name}" already exists`);
  }
  
  // Create the transformation
  const transformation = await Transformation.create(transformationData);
  
  logger.info(`Created new transformation: ${transformation.name}`, {
    transformationId: transformation.id,
    type: transformation.type
  });
  
  res.status(201).json({
    success: true,
    data: transformation
  });
});

/**
 * Get all transformations
 * @route GET /api/transformations
 */
const getTransformations = asyncHandler(async (req, res) => {
  // Apply filters if provided
  const whereClause = {};
  
  if (req.query.type) {
    whereClause.type = req.query.type;
  }
  
  if (req.query.enabled !== undefined) {
    whereClause.enabled = req.query.enabled === 'true';
  }
  
  // Get all transformations
  const transformations = await Transformation.findAll({
    where: whereClause,
    order: [['createdAt', 'DESC']]
  });
  
  res.json({
    success: true,
    count: transformations.length,
    data: transformations
  });
});

/**
 * Get a specific transformation by ID
 * @route GET /api/transformations/:id
 */
const getTransformationById = asyncHandler(async (req, res) => {
  const transformation = await Transformation.findByPk(req.params.id);
  
  if (!transformation) {
    res.status(404);
    throw new Error('Transformation not found');
  }
  
  res.json({
    success: true,
    data: transformation
  });
});

/**
 * Update a transformation
 * @route PUT /api/transformations/:id
 */
const updateTransformation = asyncHandler(async (req, res) => {
  const transformation = await Transformation.findByPk(req.params.id);
  
  if (!transformation) {
    res.status(404);
    throw new Error('Transformation not found');
  }
  
  // Check if name is being changed and already exists
  if (req.body.name && req.body.name !== transformation.name) {
    const existingTransformation = await Transformation.findOne({
      where: { name: req.body.name }
    });
    
    if (existingTransformation) {
      res.status(400);
      throw new Error(`Transformation with name "${req.body.name}" already exists`);
    }
  }
  
  // Update transformation
  await transformation.update(req.body);
  
  logger.info(`Updated transformation: ${transformation.name}`, {
    transformationId: transformation.id
  });
  
  // Refresh the router cache so it picks up the changes
  await eventRouter.refreshRoutes();
  
  res.json({
    success: true,
    data: transformation
  });
});

/**
 * Delete a transformation
 * @route DELETE /api/transformations/:id
 */
const deleteTransformation = asyncHandler(async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const transformation = await Transformation.findByPk(req.params.id, { transaction });
    
    if (!transformation) {
      await transaction.rollback();
      res.status(404);
      throw new Error('Transformation not found');
    }
    
    // Check if transformation is used by any routes
    const routesUsingTransformation = await Route.count({
      where: { transformationId: transformation.id },
      transaction
    });
    
    if (routesUsingTransformation > 0) {
      await transaction.rollback();
      res.status(400);
      throw new Error(`Cannot delete transformation "${transformation.name}" because it is used by ${routesUsingTransformation} routes`);
    }
    
    // Delete the transformation
    await transformation.destroy({ transaction });
    
    await transaction.commit();
    
    logger.info(`Deleted transformation: ${transformation.name}`, {
      transformationId: transformation.id
    });
    
    // Refresh the router cache
    await eventRouter.refreshRoutes();
    
    res.json({
      success: true,
      message: 'Transformation deleted successfully'
    });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});

/**
 * Enable or disable a transformation
 * @route PATCH /api/transformations/:id/toggle
 */
const toggleTransformation = asyncHandler(async (req, res) => {
  const transformation = await Transformation.findByPk(req.params.id);
  
  if (!transformation) {
    res.status(404);
    throw new Error('Transformation not found');
  }
  
  // Toggle enabled status
  const newStatus = !transformation.enabled;
  
  await transformation.update({
    enabled: newStatus
  });
  
  logger.info(`${newStatus ? 'Enabled' : 'Disabled'} transformation: ${transformation.name}`, {
    transformationId: transformation.id
  });
  
  // Refresh the router cache
  await eventRouter.refreshRoutes();
  
  res.json({
    success: true,
    data: transformation
  });
});

/**
 * Test a transformation with a sample event
 * @route POST /api/transformations/:id/test
 */
const testTransformation = asyncHandler(async (req, res) => {
  const transformation = await Transformation.findByPk(req.params.id);
  
  if (!transformation) {
    res.status(404);
    throw new Error('Transformation not found');
  }
  
  // Create a test event
  const testEvent = {
    id: 'test-' + Date.now(),
    eventName: req.query.eventName || 'test.event',
    timestamp: new Date(),
    properties: req.body || {
      test: true,
      message: 'This is a test event'
    }
  };
  
  try {
    // Apply the transformation
    const result = await applyTransformation(testEvent, transformation);
    
    res.json({
      success: true,
      originalEvent: testEvent,
      transformedData: result
    });
  } catch (error) {
    logger.error(`Error testing transformation:`, {
      error: error.message,
      stack: error.stack,
      transformationId: transformation.id
    });
    
    res.status(400).json({
      success: false,
      message: 'Error testing transformation',
      error: error.message
    });
  }
});

/**
 * Apply a transformation to an event
 * @private
 * @param {Object} event - The event to transform
 * @param {Object} transformation - The transformation to apply
 * @returns {Promise<Object>} - The transformed data
 */
async function applyTransformation(event, transformation) {
  const webhookForwarder = require('../services/webhookForwarder');
  
  try {
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
      transformationId: transformation.id
    });
    throw error;
  }
}

module.exports = {
  createTransformation,
  getTransformations,
  getTransformationById,
  updateTransformation,
  deleteTransformation,
  toggleTransformation,
  testTransformation
};