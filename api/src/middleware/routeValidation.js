const Joi = require('joi');

// Condition validation schemas
const propertyConditionSchema = Joi.object({
  type: Joi.string().valid('property').required(),
  property: Joi.string().required(),
  operator: Joi.string().valid(
    'equals', 'contains', 'startsWith', 'endsWith',
    'greaterThan', 'lessThan', 'in', 'exists'
  ).default('equals'),
  value: Joi.when('operator', {
    is: 'exists',
    then: Joi.forbidden(),
    otherwise: Joi.alternatives().conditional('operator', {
      is: 'in',
      then: Joi.array().items(Joi.any()).required(),
      otherwise: Joi.any().required()
    })
  })
});

const jsonpathConditionSchema = Joi.object({
  type: Joi.string().valid('jsonpath').required(),
  path: Joi.string().required(),
  operator: Joi.string().valid(
    'equals', 'contains', 'exists', 'count', 
    'greaterThan', 'lessThan'
  ).default('exists'),
  value: Joi.when('operator', {
    is: 'exists',
    then: Joi.forbidden(),
    otherwise: Joi.any().required()
  })
});

const scriptConditionSchema = Joi.object({
  type: Joi.string().valid('script').required(),
  script: Joi.string().required()
});

// Combined condition schema
const conditionSchema = Joi.alternatives().try(
  propertyConditionSchema,
  jsonpathConditionSchema,
  scriptConditionSchema
);

// Main route validation schema
const routeSchema = Joi.object({
  name: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .max(100)
    .messages({
      'string.pattern.base': 'Name must only contain alphanumeric characters, underscores, and dashes'
    }),
  description: Joi.string().allow('', null),
  eventTypes: Joi.alternatives().try(
    Joi.array().items(Joi.string()).min(1),
    Joi.array().items(Joi.string().valid('*')).length(1)
  ).default(['*']),
  transformationId: Joi.string().guid().required(),
  destinationId: Joi.string().guid().required(),
  condition: conditionSchema,
  priority: Joi.number().integer().min(0).max(1000).default(100),
  enabled: Joi.boolean().default(true)
});

module.exports = {
  routeSchema
};