const express = require('express');
const schemaController = require('../controllers/schemaController');
const apiKeyAuth = require('../middleware/simple-auth');

const router = express.Router();

// Apply API key authentication to all schema routes
router.use(apiKeyAuth);

// Database info route
router.get('/', schemaController.getDatabaseInfo);

// Table schema routes
router.get('/tables/:tableName', schemaController.getTableSchema);
router.post('/tables', schemaController.createTable);

// Template routes
router.post('/templates/:templateName', schemaController.createTableFromTemplate);

module.exports = router;