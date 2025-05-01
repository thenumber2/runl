const dataController = require('../controllers/dataController');
const { validate, dataEntrySchema, batchDataEntrySchema } = require('../middleware/validation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');

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
  
  // Data entry routes with API key authentication
  apiRouter.post('/data', 
    apiKeyAuth,
    validate(dataEntrySchema), 
    dataController.createDataEntry
  );
  
  apiRouter.post('/data/batch', 
    apiKeyAuth,
    validate(batchDataEntrySchema), 
    dataController.createBatchDataEntries
  );
  
  apiRouter.get('/data', 
    apiKeyAuth,
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getDataEntries
  );
  
  apiRouter.get('/data/:id', 
    apiKeyAuth,
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getDataEntryById
  );
  
  apiRouter.put('/data/:id', 
    apiKeyAuth,
    validate(dataEntrySchema), 
    dataController.updateDataEntry
  );
  
  apiRouter.delete('/data/:id', 
    apiKeyAuth,
    dataController.deleteDataEntry
  );
  
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