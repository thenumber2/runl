const Joi = require('joi');

// Event validation schema
const eventSchema = Joi.object({
  eventName: Joi.string().required(),
  timestamp: Joi.string().required(),
  properties: Joi.object().required()
});

module.exports = {
  eventSchema
};