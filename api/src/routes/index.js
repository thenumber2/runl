const setupSchemaRoutes = require('./schemaRoutes');
const setupDataRoutes = require('./dataRoutes');
const setupEventRoutes = require('./eventRoutes');
const setupIntegrationRoutes = require('./integrationRoutes');
const setupDestinationRoutes = require('./destinationRoutes');
const setupTransformationRoutes = require('./transformationRoutes');
const setupRouteManagementRoutes = require('./routeRoutes');

// Setup all routes
const setupRoutes = (app) => {
  const apiRouter = require('express').Router();
  
  // Public health check endpoint (no auth required)
  apiRouter.get('/health', (req, res) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date()
    });
  });
  
  // Setup modular route handlers
  setupDataRoutes(apiRouter);
  setupEventRoutes(apiRouter);
  setupSchemaRoutes(apiRouter);
  setupIntegrationRoutes(apiRouter);
  
  // Event forwarding system routes
  setupDestinationRoutes(apiRouter);
  setupTransformationRoutes(apiRouter);
  setupRouteManagementRoutes(apiRouter);
  
  // Mount all routes with /api prefix
  app.use('/api', apiRouter);
  
  // 404 route for API endpoints
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: true,
      message: 'API endpoint not found'
    });
  });
};

module.exports = {
  setupRoutes
};