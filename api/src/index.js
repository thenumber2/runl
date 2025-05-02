require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { setupRoutes } = require('./routes');
const { connectToDatabase } = require('./db/connection');
const { setupRedis } = require('./services/redis');
const logger = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitization');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { defaultRateLimiter } = require('./middleware/rateLimit');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Basic security and parsing middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json({ limit: '10mb' })); // Parse JSON requests
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded requests
app.use(morgan('combined')); // Request logging

// Add sanitization middleware - must be after body parsing but before routes
app.use(sanitizeMiddleware); // Apply sanitization to all routes

// Apply rate limiting middleware
app.use(defaultRateLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'UP', timestamp: new Date() });
});

// Setup API routes
setupRoutes(app);

// Apply error handling middleware
app.use(errorHandler);

// Apply 404 handler for any remaining unmatched routes
app.use('*', notFoundHandler);

// Start the server
async function startServer() {
  try {
    // Connect to PostgreSQL
    await connectToDatabase();
    
    // Connect to Redis
    await setupRedis();
    
    // Start listening
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Add graceful shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('Received shutdown signal, closing connections gracefully...');
  
  // Close server and connections (implement actual cleanup as needed)
  process.exit(0);
}

startServer();