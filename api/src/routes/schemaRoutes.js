const express = require('express');
const schemaController = require('../controllers/schemaController');
const apiKeyAuth = require('../middleware/auth');
const validate = require('../middleware/validation');
const { tableSchema, templateValidationSchema } = require('../middleware/schemaValidation');

// Setup schema routes
const setupSchemaRoutes = (apiRouter) => {
  const schemaRouter = express.Router();
  
  // Apply API key authentication to all schema routes
  schemaRouter.use(apiKeyAuth);
  
  // Database info route
  schemaRouter.get('/', schemaController.getDatabaseInfo);
  
  // Table schema routes
  schemaRouter.get('/tables/:tableName', schemaController.getTableSchema);
  schemaRouter.post('/tables', validate(tableSchema), schemaController.createTable);
  
  // Template routes
  schemaRouter.post('/templates/:templateName', validate(templateValidationSchema), schemaController.createTableFromTemplate);
  
  // Mount the schema routes
  apiRouter.use('/admin/schema', schemaRouter);
};

module.exports = setupSchemaRoutes;