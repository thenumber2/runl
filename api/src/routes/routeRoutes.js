const express = require('express');
const routeController = require('../controllers/routeController');
const validate = require('../middleware/validation');
const { routeSchema } = require('../middleware/routeValidation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');

// Setup route management routes
const setupRouteManagementRoutes = (apiRouter) => {
  // Apply API key authentication to all route management routes
  const routeManagementRouter = express.Router();
  routeManagementRouter.use(apiKeyAuth);
  
  // Create a new route
  routeManagementRouter.post('/',
    validate(routeSchema),
    routeController.createRoute
  );
  
  // Get all routes with filtering
  routeManagementRouter.get('/',
    cacheMiddleware(30), // Cache for 30 seconds
    routeController.getRoutes
  );
  
  // Get a route by ID
  routeManagementRouter.get('/:id',
    cacheMiddleware(30), // Cache for 30 seconds
    routeController.getRouteById
  );
  
  // Update a route
  routeManagementRouter.put('/:id',
    validate(routeSchema),
    routeController.updateRoute
  );
  
  // Delete a route
  routeManagementRouter.delete('/:id',
    routeController.deleteRoute
  );
  
  // Enable/disable a route
  routeManagementRouter.patch('/:id/toggle',
    routeController.toggleRoute
  );
  
  // Test a route
  routeManagementRouter.post('/:id/test',
    routeController.testRoute
  );
  
  // Mount the route management routes
  apiRouter.use('/routes', routeManagementRouter);
  
  // Log initialization
  const logger = require('../utils/logger');
  logger.info('Route management routes initialized');
};

module.exports = setupRouteManagementRoutes;