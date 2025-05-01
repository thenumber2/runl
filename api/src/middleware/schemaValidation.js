const Joi = require('joi');

// Schema validation for table creation
const tableSchema = Joi.object({
  tableName: Joi.string()
    .pattern(/^[a-zA-Z0-9_]+$/)
    .required()
    .messages({
      'string.pattern.base': 'Table name must contain only alphanumeric characters and underscores'
    }),
  columns: Joi.array()
    .items(
      Joi.object({
        name: Joi.string()
          .pattern(/^[a-zA-Z0-9_]+$/)
          .required()
          .messages({
            'string.pattern.base': 'Column name must contain only alphanumeric characters and underscores'
          }),
        type: Joi.string()
          .pattern(/^[a-zA-Z0-9_\(\)]+$/)
          .required()
          .messages({
            'string.pattern.base': 'Column type must be a valid PostgreSQL data type'
          }),
        primaryKey: Joi.boolean().default(false),
        unique: Joi.boolean().default(false),
        notNull: Joi.boolean().default(false),
        defaultValue: Joi.any()
      })
    )
    .min(1)
    .required(),
  indexes: Joi.array().items(
    Joi.object({
      name: Joi.string().pattern(/^[a-zA-Z0-9_]+$/),
      columns: Joi.array().items(Joi.string()).min(1).required(),
      unique: Joi.boolean().default(false),
      method: Joi.string().valid('btree', 'hash', 'gist', 'gin', 'spgist', 'brin')
    })
  ),
  constraints: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('PRIMARY KEY', 'UNIQUE', 'CHECK', 'FOREIGN KEY').required(),
      columns: Joi.array().items(Joi.string()).min(1).required(),
      definition: Joi.string().when('type', {
        is: 'CHECK',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      }),
      references: Joi.object({
        table: Joi.string().required(),
        columns: Joi.array().items(Joi.string()).min(1).required()
      }).when('type', {
        is: 'FOREIGN KEY',
        then: Joi.required(),
        otherwise: Joi.forbidden()
      }),
      onDelete: Joi.string().valid('CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'),
      onUpdate: Joi.string().valid('CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION')
    })
  )
});

// Template validation schema
const templateValidationSchema = Joi.object({
  // We can add parameters for template customization if needed
  // For now, just a placeholder since the controller doesn't expect body params
}).unknown(true);

module.exports = {
  tableSchema,
  templateValidationSchema
};