const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');

/**
 * Transformation model for storing event data transformation configurations
 */
const Transformation = sequelize.define('Transformation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Unique identifier for the transformation'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional description of what this transformation does'
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Type of transformation (mapping, template, script, etc.)'
  },
  config: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'Configuration for the transformation'
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Whether this transformation is currently active'
  }
}, {
  tableName: 'transformations',
  timestamps: true,
  indexes: [
    {
      name: 'transformations_name_idx',
      unique: true,
      fields: ['name']
    },
    {
      name: 'transformations_type_idx',
      fields: ['type']
    },
    {
      name: 'transformations_enabled_idx',
      fields: ['enabled']
    }
  ]
});

module.exports = Transformation;