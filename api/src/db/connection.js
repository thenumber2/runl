const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Create Sequelize instance with improved configuration
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'data',
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  logging: msg => logger.debug(msg),
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  retry: {
    max: 3, // Maximum number of connection retries
    match: [
      /ConnectionError/,
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionTimedOutError/,
      /TimeoutError/,
      /SequelizeConnectionAcquireTimeoutError/
    ]
  }
});

/**
 * Connect to the database with improved error handling
 * @returns {Promise<Sequelize>} - Sequelize instance
 * @throws {Error} If connection cannot be established after retries
 */
async function connectToDatabase() {
  try {
    // Test the connection
    await sequelize.authenticate();
    logger.info('Database connection established successfully.', {
      host: sequelize.config.host,
      database: sequelize.config.database
    });
    
    // Sync models with database in non-production environments
    if (process.env.NODE_ENV !== 'production') {
      try {
        await sequelize.sync({ alter: true });
        logger.info('Database models synchronized.');
      } catch (syncError) {
        logger.error('Error synchronizing database models:', {
          error: syncError.message,
          stack: syncError.stack
        });
        // Don't throw here - connection is established, sync is secondary
      }
    }
    
    return sequelize;
  } catch (error) {
    logger.error('Unable to connect to the database:', {
      error: error.message,
      stack: error.stack,
      host: process.env.POSTGRES_HOST || 'postgres',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'data',
      user: process.env.POSTGRES_USER ? '***' : 'undefined' // Don't log actual username
    });
    throw error;
  }
}

/**
 * Close database connection gracefully
 * @returns {Promise<void>}
 */
async function closeConnection() {
  try {
    await sequelize.close();
    logger.info('Database connection closed successfully.');
  } catch (error) {
    logger.error('Error closing database connection:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Check database connection health
 * @returns {Promise<boolean>} - True if connection is healthy
 */
async function checkConnection() {
  try {
    await sequelize.authenticate({ logging: false });
    return true;
  } catch (error) {
    logger.warn('Database connection health check failed:', {
      error: error.message
    });
    return false;
  }
}

/**
 * Handle a transaction with automatic rollback on error
 * @param {Function} callback - Function that receives and uses the transaction
 * @returns {Promise<any>} - Result of the callback function
 */
async function withTransaction(callback) {
  const transaction = await sequelize.transaction();
  
  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error('Error rolling back transaction:', {
        error: rollbackError.message,
        originalError: error.message
      });
    }
    throw error;
  }
}

module.exports = {
  sequelize,
  connectToDatabase,
  closeConnection,
  checkConnection,
  withTransaction
};