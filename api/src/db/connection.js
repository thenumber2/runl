const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Create Sequelize instance
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
  }
});

// Connection function that can be called to test and establish the connection
const connectToDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully.');
    
    // Sync models with database (in production, use migrations instead)
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
      logger.info('Database models synchronized.');
    }
    
    return sequelize;
  } catch (error) {
    logger.error('Unable to connect to the database:', error);
    throw error;
  }
};

module.exports = {
  sequelize,
  connectToDatabase
};