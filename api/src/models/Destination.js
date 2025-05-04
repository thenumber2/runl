const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');
const cryptoUtil = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Destination model for storing webhook forwarding targets
 */
const Destination = sequelize.define('Destination', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Unique identifier for the destination'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional description of the destination'
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Type of destination (slack, mixpanel, webhook, custom, etc.)'
  },
  url: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Webhook URL where transformed events are sent'
  },
  method: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'POST',
    comment: 'HTTP method to use (POST, PUT, etc.)'
  },
  config: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
    comment: 'Additional configuration (headers, auth, etc.)'
  },
  secretKey: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Secret for signing payloads (encrypted in database)'
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Whether this destination is currently active'
  },
  timeout: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5000,
    comment: 'Timeout in ms for webhook requests'
  },
  retryStrategy: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Configuration for automatic retries on failure'
  },
  lastSent: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When an event was last sent to this destination'
  },
  successCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Count of successful event deliveries'
  },
  failureCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Count of failed event deliveries'
  },
  lastError: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Last error message when sending failed'
  }
}, {
  tableName: 'destinations',
  timestamps: true,
  indexes: [
    {
      name: 'destinations_name_idx',
      unique: true,
      fields: ['name']
    },
    {
      name: 'destinations_type_idx',
      fields: ['type']
    },
    {
      name: 'destinations_enabled_idx',
      fields: ['enabled']
    }
  ],
  hooks: {
    // Encrypt secret before saving
    beforeSave: async (destination) => {
      try {
        // Only encrypt if the secret has changed and is not already encrypted
        if (destination.changed('secretKey') && 
            destination.secretKey && 
            !cryptoUtil.isEncrypted(destination.secretKey)) {
          destination.secretKey = cryptoUtil.encrypt(destination.secretKey);
        }
      } catch (error) {
        logger.error('Error encrypting secret key:', error);
      }
    }
  }
});

// Add instance method to get decrypted secret
Destination.prototype.getDecryptedSecret = function() {
  if (!this.secretKey) return null;
  
  try {
    // Only decrypt if it looks encrypted
    if (cryptoUtil.isEncrypted(this.secretKey)) {
      return cryptoUtil.decrypt(this.secretKey);
    }
    return this.secretKey; // Return as-is for backward compatibility
  } catch (error) {
    logger.error('Error decrypting secret key:', error);
    return null;
  }
};

module.exports = Destination;