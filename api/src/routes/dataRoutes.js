const dataController = require('../controllers/dataController');
const validate = require('../middleware/validation');
const { dataSchema, batchDataSchema } = require('../middleware/dataValidation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');

// Setup data routes
const setupDataRoutes = (apiRouter) => {
  // Apply API key authentication to all data routes
  const dataRouter = require('express').Router();
  dataRouter.use(apiKeyAuth);
  
  // Create data record
  dataRouter.post('/', 
    validate(dataSchema), 
    dataController.createData
  );
  
  // Create batch data records
  dataRouter.post('/batch', 
    validate(batchDataSchema), 
    dataController.createBatchData
  );
  
  // Get all data records with pagination
  dataRouter.get('/', 
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getAllData
  );
  
  // Get a single data record by ID
  dataRouter.get('/:id', 
    cacheMiddleware(60), // Cache for 1 minute
    dataController.getDataById
  );
  
  // Update a data record
  dataRouter.put('/:id', 
    validate(dataSchema), 
    dataController.updateData
  );
  
  // Delete a data record
  dataRouter.delete('/:id', 
    dataController.deleteData
  );
  
  // Mount the data routes
  apiRouter.use('/data', dataRouter);
};

module.exports = setupDataRoutes;