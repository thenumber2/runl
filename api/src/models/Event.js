const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');

const Event = sequelize.define('Event', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  eventName: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Type of event (e.g., "User Created")'
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'When the event occurred'
  },
  properties: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Full event payload data'
  }
}, {
  tableName: 'events',
  timestamps: true,
  indexes: [
    {
      name: 'events_event_name_idx',
      fields: ['eventName']
    },
    {
      name: 'events_timestamp_idx',
      fields: ['timestamp']
    },
    {
      // JSONB path index for userId using a safer approach
      name: 'events_user_id_idx',
      using: 'gin',
      fields: [
        sequelize.fn('jsonb_path_ops', sequelize.col('properties'))
      ]
    }
  ]
});

// Add an additional method to easily find events by userId
Event.findByUserId = function(userId, options = {}) {
  return this.findAll({
    where: sequelize.where(
      sequelize.json('properties.userId'),
      '=',
      userId
    ),
    ...options
  });
};

module.exports = Event;