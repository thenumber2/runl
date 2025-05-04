const Joi = require('joi');

// Transform validation schemas
const transformTemplateSchema = Joi.object({
  type: Joi.string().valid('template').required(),
  config: Joi.object({
    template: Joi.string(),
    templates: Joi.object().pattern(Joi.string(), Joi.string())
  }).xor('template', 'templates').required()
});

const transformScriptSchema = Joi.object({
  type: Joi.string().valid('script').required(),
  config: Joi.object({
    script: Joi.string().required()
  }).required()
});

const transformJsonPathSchema = Joi.object({
  type: Joi.string().valid('jsonpath').required(),
  config: Joi.object({
    mapping: Joi.object().pattern(Joi.string(), Joi.string()).required(),
    defaults: Joi.object().pattern(Joi.string(), Joi.any())
  }).required()
});

const transformMappingSchema = Joi.object({
  type: Joi.string().valid('mapping').required(),
  config: Joi.object({
    mapping: Joi.object().pattern(
      Joi.string(),
      Joi.alternatives().try(
        Joi.string(),
        Joi.array().items(Joi.string()),
        Joi.object({
          path: Joi.string().required(),
          default: Joi.any()
        })
      )
    ).required(),
    includeOriginal: Joi.alternatives().try(
      Joi.boolean(),
      Joi.array().items(Joi.string())
    ),
    fixed: Joi.object().pattern(Joi.string(), Joi.any())
  }).required()
});

const transformSlackSchema = Joi.object({
  type: Joi.string().valid('slack').required(),
  config: Joi.object({
    username: Joi.string(),
    icon_emoji: Joi.string(),
    channel: Joi.string(),
    message: Joi.string(),
    blocks: Joi.array().items(Joi.object())
  })
});

const transformMixpanelSchema = Joi.object({
  type: Joi.string().valid('mixpanel').required(),
  config: Joi.object({
    includeProperties: Joi.alternatives().try(
      Joi.boolean().valid(false),
      Joi.array().items(Joi.string())
    ),
    excludeProperties: Joi.array().items(Joi.string()),
    eventNamePrefix: Joi.string()
  })
});

const transformIdentitySchema = Joi.object({
  type: Joi.string().valid('identity').required()
});

// Combined transform schema
const transformSchema = Joi.alternatives().try(
  transformTemplateSchema,
  transformScriptSchema,
  transformJsonPathSchema,
  transformMappingSchema,
  transformSlackSchema,
  transformMixpanelSchema,
  transformIdentitySchema
);

// Retry strategy schema
const retryStrategySchema = Joi.object({
  maxRetries: Joi.number().integer().min(0).max(10).default(3),
  initialDelay: Joi.number().integer().min(100).max(60000).default(1000),
  maxDelay: Joi.number().integer().min(1000).max(3600000).default(60000),
  backoffFactor: Joi.number().min(1).max(10).default(2),
  retryableStatusCodes: Joi.array().items(
    Joi.number().integer().min(400).max(599)
  ).default([408, 429, 500, 502, 503, 504])
});

// Main destination validation schema
const destinationSchema = Joi.object({
  name: Joi.string()
    .required()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .max(100)
    .messages({
      'string.pattern.base': 'Name must only contain alphanumeric characters, underscores, and dashes'
    }),
  description: Joi.string().allow('', null),
  type: Joi.string()
    .required()
    .valid('slack', 'mixpanel', 'webhook', 'custom')
    .messages({
      'any.only': 'Type must be one of: slack, mixpanel, webhook, custom'
    }),
  url: Joi.string()
    .required()
    .uri()
    .messages({
      'string.uri': 'URL must be a valid URI'
    }),
  method: Joi.string()
    .valid('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
    .default('POST'),
  eventTypes: Joi.alternatives().try(
    Joi.array().items(Joi.string()).min(1),
    Joi.array().items(Joi.string().valid('*')).length(1)
  ).default(['*']),
  config: Joi.object({
    headers: Joi.object().pattern(
      Joi.string(), 
      Joi.string()
    ).default({}),
    channel: Joi.string().when('..type', {
      is: 'slack',
      then: Joi.string(),
      otherwise: Joi.optional()
    }),
    username: Joi.string().when('..type', {
      is: 'slack',
      then: Joi.string(),
      otherwise: Joi.optional()
    }),
    icon_emoji: Joi.string().when('..type', {
      is: 'slack',
      then: Joi.string(),
      otherwise: Joi.optional()
    }),
    format: Joi.string().valid('json', 'form', 'text').default('json'),
    contentType: Joi.string()
  }).default({}),
  transform: transformSchema,
  secretKey: Joi.string().allow('', null),
  enabled: Joi.boolean().default(true),
  timeout: Joi.number().integer().min(1000).max(60000).default(5000),
  retryStrategy: retryStrategySchema,
  // These fields should be managed by the system, not set directly
  lastSent: Joi.any().forbidden(),
  successCount: Joi.any().forbidden(),
  failureCount: Joi.any().forbidden(),
  lastError: Joi.any().forbidden()
});

module.exports = {
  destinationSchema
};