const express = require('express');
const destinationController = require('../controllers/destinationController');
const validate = require('../middleware/validation');
const { destinationSchema } = require('../middleware/destinationValidation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');

// Setup destination routes
const setupDestinationRoutes = (apiRouter) => {
  // Apply API key authentication to all destination routes
  const destinationRouter = express.Router();
  destinationRouter.use(apiKeyAuth);
  
  // Get destination statistics
  destinationRouter.get('/stats',
    cacheMiddleware(30), // Cache for 30 seconds
    destinationController.getDestinationStats
  );
  
  // Create a new destination
  destinationRouter.post('/',
    validate(destinationSchema),
    destinationController.createDestination
  );
  
  // Get all destinations
  destinationRouter.get('/',
    cacheMiddleware(30), // Cache for 30 seconds
    destinationController.getDestinations
  );
  
  // Get a destination by ID
  destinationRouter.get('/:id',
    cacheMiddleware(30), // Cache for 30 seconds
    destinationController.getDestinationById
  );
  
  // Update a destination
  destinationRouter.put('/:id',
    validate(destinationSchema),
    destinationController.updateDestination
  );
  
  // Delete a destination
  destinationRouter.delete('/:id',
    destinationController.deleteDestination
  );
  
  // Enable/disable a destination
  destinationRouter.patch('/:id/toggle',
    destinationController.toggleDestination
  );
  
  // Test a destination
  destinationRouter.post('/:id/test',
    destinationController.testDestination
  );
  
  // Mount the destination routes
  apiRouter.use('/destinations', destinationRouter);
  
  // Log initialization
  const logger = require('../utils/logger');
  logger.info('Destination routes initialized');
};

module.exports = setupDestinationRoutes;