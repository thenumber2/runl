const dataController = require('../api/controllers/dataController');
const { validate, dataEntrySchema, batchDataEntrySchema } = require('../middleware/validation');
const { cacheMiddleware } = require('../services/redis');

// Setup all routes
const setupRoutes = (app) => {
  const apiRouter = require('express').Router();
  
  // Data entry routes
  apiRouter.post('/data', 
    validate(dataEntrySchema), 
    dataController.createDataEntry
  );
  
  apiRouter.post('/data/batch', 
    validate(batchDataEntrySchema), 
    dataController.createBatchDataEntries
  );
  
  apiRouter.get('/data', 
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getDataEntries
  );
  
  apiRouter.get('/data/:id', 
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getDataEntryById
  );
  
  apiRouter.put('/data/:id', 
    validate(dataEntrySchema), 
    dataController.updateDataEntry
  );
  
  apiRouter.delete('/data/:id', 
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