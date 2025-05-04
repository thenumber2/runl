const Joi = require('joi');

// Transform validation schemas
const mappingTransformSchema = Joi.object({
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
});

const templateTransformSchema = Joi.object({
  template: Joi.string(),
  templates: Joi.object().pattern(Joi.string(), Joi.string())
}).xor('template', 'templates');

const scriptTransformSchema = Joi.object({
  script: Joi.string().required()
});

const jsonpathTransformSchema = Joi.object({
  mapping: Joi.object().pattern(Joi.string(), Joi.string()).required(),
  defaults: Joi.object().pattern(Joi.string(), Joi.any())
});

const slackTransformSchema = Joi.object({
  username: Joi.string(),
  icon_emoji: Joi.string(),
  channel: Joi.string(),
  message: Joi.string(),
  blocks: Joi.array().items(Joi.object())
});

const mixpanelTransformSchema = Joi.object({
  includeProperties: Joi.alternatives().try(
    Joi.boolean().valid(false),
    Joi.array().items(Joi.string())
  ),
  excludeProperties: Joi.array().items(Joi.string()),
  eventNamePrefix: Joi.string()
});

// Main transformation validation schema
const transformationSchema = Joi.object({
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
    .valid('mapping', 'template', 'script', 'jsonpath', 'slack', 'mixpanel', 'identity')
    .messages({
      'any.only': 'Type must be one of: mapping, template, script, jsonpath, slack, mixpanel, identity'
    }),
  config: Joi.alternatives()
    .conditional('type', [
      { is: 'mapping', then: mappingTransformSchema.required() },
      { is: 'template', then: templateTransformSchema.required() },
      { is: 'script', then: scriptTransformSchema.required() },
      { is: 'jsonpath', then: jsonpathTransformSchema.required() },
      { is: 'slack', then: slackTransformSchema.required() },
      { is: 'mixpanel', then: mixpanelTransformSchema.required() },
      { is: 'identity', then: Joi.object().default({}) }
    ]),
  enabled: Joi.boolean().default(true)
});

module.exports = {
  transformationSchema
};