require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { setupRoutes } = require('./routes');
const { connectToDatabase } = require('./db/connection');
const redisService = require('./services/redis');
const logger = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitization');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { defaultRateLimiter } = require('./middleware/rateLimit');
const eventRouter = require('./services/eventRouter');
const webhookForwarder = require('./services/webhookForwarder');
const { loadDestinationsFromDatabase } = require('./controllers/destinationController');
// Load transformerService to ensure it's initialized first
const transformerService = require('./services/transformerService');

// Initialize Express app
const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Basic security and parsing middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS

// Body parsing middleware
// Important: express.json() would consume the request body
// We need to preserve the raw body for Stripe webhook signature verification
app.use((req, res, next) => {
  // Skip JSON parsing for the Stripe webhook endpoint
  // This preserves the raw body for signature verification
  if (req.originalUrl === '/api/integrations/stripe/webhook') {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});

app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded requests
app.use(morgan('combined')); // Request logging

// Add sanitization middleware - must be after body parsing but before routes
// Skip for Stripe webhook route which needs raw body
app.use((req, res, next) => {
  if (req.originalUrl === '/api/integrations/stripe/webhook') {
    next();
  } else {
    sanitizeMiddleware(req, res, next);
  }
});

// Apply rate limiting middleware (skip for Stripe webhooks)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/integrations/stripe/webhook') {
    next();
  } else {
    defaultRateLimiter(req, res, next);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    apiVersion: '1.0.0', // Add API version
    timestamp: new Date(),
    redis: redisService.isRedisConnected() ? 'Connected' : 'Disconnected',
  });
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
    
    // Configure and connect to Redis with improved service
    await redisService
      .configure({
        host: process.env.REDIS_HOST || 'redis',
        port: process.env.REDIS_PORT || 6379,
        maxReconnectAttempts: 10,
        initialBackoff: 100,
        maxBackoff: 10000
      })
      .connect();
    
    // Initialize event forwarding system components in the correct order
    logger.info('Initializing event forwarding system...');
    
    // 1. First make sure transformerService is ready
    logger.info('Transformer service loaded with supported types:', Object.keys(transformerService.transformers));
    
    // 2. Load destinations from database to webhook forwarder
    try {
      await loadDestinationsFromDatabase();
      logger.info('Destinations loaded into webhook forwarder');
    } catch (error) {
      logger.error('Failed to load destinations:', error);
      // Continue starting the server even if destinations fail to load
    }
    
    // 3. Initialize event router (loads active routes)
    try {
      await eventRouter.initialize();
      logger.info('Event Router initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Event Router:', error);
      // Continue starting the server even if Event Router fails
    }
    
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
  
  // Gracefully close Redis connection
  await redisService.disconnect();
  
  // Close other connections as needed
  // TODO: Add proper shutdown for other services (database, etc.)
  
  process.exit(0);
}

startServer();