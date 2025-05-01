const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');

// Create a generic DataEntry model that can be customized based on your needs
const DataEntry = sequelize.define('DataEntry', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Example fields - modify these based on your data structure
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  data: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Flexible JSON schema for storing different types of data'
  },
  source: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('pending', 'processed', 'error'),
    defaultValue: 'pending'
  }
}, {
  tableName: 'data_entries',
  timestamps: true,
  indexes: [
    {
      name: 'data_entries_timestamp_idx',
      fields: ['timestamp']
    },
    {
      name: 'data_entries_status_idx',
      fields: ['status']
    }
  ]
});

module.exports = DataEntry;