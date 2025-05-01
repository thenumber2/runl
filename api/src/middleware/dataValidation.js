const Joi = require('joi');

// Data validation schema
const dataSchema = Joi.object({
  title: Joi.string().required().max(255),
  description: Joi.string().allow('', null),
  data: Joi.object().required(),
  source: Joi.string().allow('', null),
  timestamp: Joi.date().default(Date.now),
  metadata: Joi.object().default({}),
  status: Joi.string().valid('pending', 'processed', 'error').default('pending')
});

// Batch data validation schema
const batchDataSchema = Joi.object({
  entries: Joi.array().items(dataSchema).min(1).required()
});

module.exports = {
  dataSchema,
  batchDataSchema
};