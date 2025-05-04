const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');
const Transformation = require('./Transformation');
const Destination = require('./Destination');

/**
 * Route model that connects event types to transformations and destinations
 */
const Route = sequelize.define('Route', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Unique identifier for the route'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional description of what this route does'
  },
  eventTypes: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: ['*'],
    comment: 'Array of event names to match, or ["*"] for all events'
  },
  transformationId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'Reference to the transformation to apply'
  },
  destinationId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: 'Reference to the destination to send to'
  },
  condition: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Optional additional conditions for matching events'
  },
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100,
    comment: 'Order in which routes are processed (lower numbers first)'
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Whether this route is currently active'
  },
  lastUsed: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When this route was last used'
  },
  useCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'How many times this route has been used'
  }
}, {
  tableName: 'routes',
  timestamps: true,
  indexes: [
    {
      name: 'routes_name_idx',
      unique: true,
      fields: ['name']
    },
    {
      name: 'routes_transformation_idx',
      fields: ['transformationId']
    },
    {
      name: 'routes_destination_idx',
      fields: ['destinationId']
    },
    {
      name: 'routes_enabled_idx',
      fields: ['enabled']
    },
    {
      name: 'routes_priority_idx',
      fields: ['priority']
    }
  ]
});

// Set up associations
Route.belongsTo(Transformation, {
  foreignKey: 'transformationId',
  as: 'transformation'
});

Route.belongsTo(Destination, {
  foreignKey: 'destinationId',
  as: 'destination'
});

Transformation.hasMany(Route, {
  foreignKey: 'transformationId',
  as: 'routes'
});

Destination.hasMany(Route, {
  foreignKey: 'destinationId',
  as: 'routes'
});

module.exports = Route;