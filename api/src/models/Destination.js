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
    // Encrypt secret before saving with improved error handling
    beforeSave: async (destination, options) => {
      try {
        // Only encrypt if the secret has changed and is not already encrypted
        if (destination.changed('secretKey') && 
            destination.secretKey && 
            !isEncrypted(destination.secretKey)) {
          destination.secretKey = await encryptSecret(destination.secretKey);
        }
      } catch (error) {
        logger.error('Error encrypting secret key:', {
          error: error.message,
          stack: error.stack,
          destinationId: destination.id,
          destinationName: destination.name
        });
        // Don't throw - allow the save to continue with original value
      }
    }
  }
});

/**
 * Check if a text is already encrypted
 * @param {string} text - Text to check
 * @returns {boolean} - Whether the text is encrypted
 */
function isEncrypted(text) {
  try {
    if (!text || typeof text !== 'string') {
      return false;
    }
    
    return cryptoUtil.isEncrypted(text);
  } catch (error) {
    logger.error('Error checking if text is encrypted:', {
      error: error.message,
      stack: error.stack
    });
    return false; // Fail safely by assuming it's not encrypted
  }
}

/**
 * Encrypt a secret value
 * @param {string} text - Text to encrypt
 * @returns {Promise<string>} - Encrypted text
 */
async function encryptSecret(text) {
  try {
    return cryptoUtil.encrypt(text);
  } catch (error) {
    logger.error('Error in encryptSecret:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get decrypted secret for the destination
 * @returns {string|null} - Decrypted secret or null
 */
Destination.prototype.getDecryptedSecret = function() {
  try {
    if (!this.secretKey) {
      return null;
    }
    
    // Only decrypt if it looks encrypted
    if (isEncrypted(this.secretKey)) {
      return cryptoUtil.decrypt(this.secretKey);
    }
    
    // Return as-is for backward compatibility
    return this.secretKey;
  } catch (error) {
    logger.error('Error decrypting secret key:', {
      error: error.message,
      stack: error.stack,
      destinationId: this.id,
      destinationName: this.name
    });
    return null; // Fail safely by not providing the secret
  }
};

/**
 * Create a sanitized version of the destination without sensitive data
 * @returns {Object} - Sanitized destination data
 */
Destination.prototype.toSafeJSON = function() {
  const json = this.toJSON();
  
  // Remove the secret key from the response
  if (json.secretKey) {
    json.hasSecret = true;
    delete json.secretKey;
  } else {
    json.hasSecret = false;
  }
  
  return json;
};

/**
 * Update the success statistics for the destination
 * @returns {Promise<void>}
 */
Destination.prototype.recordSuccess = async function() {
  try {
    await this.increment('successCount');
    await this.update({
      lastSent: new Date(),
      lastError: null
    });
  } catch (error) {
    logger.error('Error recording destination success:', {
      error: error.message,
      stack: error.stack,
      destinationId: this.id,
      destinationName: this.name
    });
    // Don't throw - stats updates are not critical
  }
};

/**
 * Update the failure statistics for the destination
 * @param {string} errorMessage - The error message
 * @returns {Promise<void>}
 */
Destination.prototype.recordFailure = async function(errorMessage) {
  try {
    await this.increment('failureCount');
    await this.update({
      lastError: errorMessage
    });
  } catch (error) {
    logger.error('Error recording destination failure:', {
      error: error.message,
      stack: error.stack,
      destinationId: this.id,
      destinationName: this.name,
      originalError: errorMessage
    });
    // Don't throw - stats updates are not critical
  }
};

module.exports = Destination;