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
      // JSONB path index for userId
      name: 'events_user_id_idx',
      fields: [
        sequelize.literal('((properties->>\'userId\'))::text')
      ]
    }
  ]
});

module.exports = Event;