const Joi = require('joi');
const logger = require('../utils/logger');

// Generic validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn(`Validation error: ${errorMessage}`, { 
        path: req.path, 
        body: req.body 
      });
      
      return res.status(400).json({
        error: true,
        message: 'Validation failed',
        details: error.details
      });
    }
    
    next();
  };
};

// Data entry validation schema
const dataEntrySchema = Joi.object({
  title: Joi.string().required().max(255),
  description: Joi.string().allow('', null),
  data: Joi.object().required(),
  source: Joi.string().allow('', null),
  timestamp: Joi.date().default(Date.now),
  metadata: Joi.object().default({}),
  status: Joi.string().valid('pending', 'processed', 'error').default('pending')
});

// Batch data entry validation schema
const batchDataEntrySchema = Joi.object({
  entries: Joi.array().items(dataEntrySchema).min(1).required()
});

module.exports = {
  validate,
  dataEntrySchema,
  batchDataEntrySchema
};