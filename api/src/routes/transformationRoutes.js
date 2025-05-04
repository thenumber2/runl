const express = require('express');
const transformationController = require('../controllers/transformationController');
const validate = require('../middleware/validation');
const { transformationSchema } = require('../middleware/transformationValidation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');

// Setup transformation routes
const setupTransformationRoutes = (apiRouter) => {
  // Apply API key authentication to all transformation routes
  const transformationRouter = express.Router();
  transformationRouter.use(apiKeyAuth);
  
  // Create a new transformation
  transformationRouter.post('/',
    validate(transformationSchema),
    transformationController.createTransformation
  );
  
  // Get all transformations with filtering
  transformationRouter.get('/',
    cacheMiddleware(30), // Cache for 30 seconds
    transformationController.getTransformations
  );
  
  // Get a transformation by ID
  transformationRouter.get('/:id',
    cacheMiddleware(30), // Cache for 30 seconds
    transformationController.getTransformationById
  );
  
  // Update a transformation
  transformationRouter.put('/:id',
    validate(transformationSchema),
    transformationController.updateTransformation
  );
  
  // Delete a transformation
  transformationRouter.delete('/:id',
    transformationController.deleteTransformation
  );
  
  // Enable/disable a transformation
  transformationRouter.patch('/:id/toggle',
    transformationController.toggleTransformation
  );
  
  // Test a transformation
  transformationRouter.post('/:id/test',
    transformationController.testTransformation
  );
  
  // Mount the transformation routes
  apiRouter.use('/transformations', transformationRouter);
  
  // Log initialization
  const logger = require('../utils/logger');
  logger.info('Transformation routes initialized');
};

module.exports = setupTransformationRoutes;