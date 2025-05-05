require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const fs = require('fs');
const { setupRoutes } = require('./routes');
const { connectToDatabase, closeConnection, sequelize } = require('./db/connection');
const redisService = require('./services/redis');
const logger = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitization');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { defaultRateLimiter } = require('./middleware/rateLimit');
const eventRouter = require('./services/eventRouter');
const webhookForwarder = require('./services/webhookForwarder');
const { loadDestinationsFromDatabase } = require('./controllers/destinationController');

// Make sure transformerService is initialized first
const transformerService = require('./services/transformerService');

// Import WebSocket service
const websocketService = require('./services/websocketService');

// Initialize Express app
const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

/**
 * Configure and initialize application
 * @returns {Promise<void>}
 */
async function initializeApp() {
  try {
    // Set up basic middleware
    configureMiddleware(app);
    
    // Setup health check endpoint
    setupHealthCheck(app);
    
    // Setup API routes
    setupRoutes(app);
    
    // Apply error handling middleware
    app.use(errorHandler);
    
    // Apply 404 handler for any remaining unmatched routes
    app.use('*', notFoundHandler);
    
    // Log app configuration
    logger.info('Express app configured successfully');
  } catch (error) {
    logger.error('Failed to initialize app:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Configure Express middleware
 * @param {Object} app - Express app
 */
function configureMiddleware(app) {
  // Security middleware with flexible content security policy
  const cspDirectives = {
    connectSrc: ["'self'"]
  };
  
  // Add client origin to CSP if it exists
  if (process.env.CLIENT_ORIGIN) {
    // Handle comma-separated origins
    if (process.env.CLIENT_ORIGIN.includes(',')) {
      const origins = process.env.CLIENT_ORIGIN.split(',').map(origin => origin.trim());
      cspDirectives.connectSrc.push(...origins);
    } else {
      cspDirectives.connectSrc.push(process.env.CLIENT_ORIGIN);
    }
  }
  
  // Add common development origins for convenience
  cspDirectives.connectSrc.push(
    'http://localhost:3001', 
    'https://localhost:3001',
    'http://127.0.0.1:3001'
  );
  
  // Configure Helmet with appropriate CSP
  app.use(helmet({
    contentSecurityPolicy: {
      directives: cspDirectives
    }
  }));
  
  // Use custom CORS configuration that supports various environments
  try {
    const configureCors = require('./middleware/corsConfig');
    app.use(configureCors());
    logger.info('Custom CORS configuration applied');
  } catch (corsError) {
    // Fallback to basic CORS if custom configuration is not available
    logger.warn('Custom CORS configuration not found, using default CORS', {
      error: corsError.message
    });
    app.use(cors());
  }
  
  // Special handling for Stripe webhook
  app.use((req, res, next) => {
    // Skip JSON parsing for the Stripe webhook endpoint to preserve raw body
    if (req.originalUrl === '/api/integrations/stripe/webhook') {
      next();
    } else {
      express.json({ limit: '10mb' })(req, res, next);
    }
  });
  
  // URL-encoded body parser
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Request logging
  app.use(morgan('combined'));
  
  // Add sanitization middleware - skip for Stripe webhook
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/integrations/stripe/webhook') {
      next();
    } else {
      sanitizeMiddleware(req, res, next);
    }
  });
  
  // Apply rate limiting - skip for Stripe webhooks
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/integrations/stripe/webhook') {
      next();
    } else {
      defaultRateLimiter(req, res, next);
    }
  });
}

/**
 * Setup health check endpoint
 * @param {Object} app - Express app
 */
function setupHealthCheck(app) {
  app.get('/health', async (req, res) => {
    try {
      // Check database connection
      const dbStatus = await checkDatabaseHealth();
      
      // Check Redis connection
      const redisStatus = redisService.isRedisConnected() ? 'Connected' : 'Disconnected';
      
      // Check WebSocket status
      const wsStatus = websocketService.initialized ? 'Initialized' : 'Not Initialized';
      
      // Determine if running in Docker
      const isDocker = fs.existsSync('/.dockerenv') || process.env.RUNNING_IN_DOCKER === 'true';
      
      res.status(200).json({
        status: 'UP',
        apiVersion: '1.0.0',
        timestamp: new Date(),
        database: dbStatus,
        redis: redisStatus,
        websocket: wsStatus,
        isDocker: isDocker,
        environment: process.env.NODE_ENV || 'development',
        clientOrigin: process.env.CLIENT_ORIGIN || 'auto-detect',
        corsAllowAll: process.env.CORS_ALLOW_ALL === 'true'
      });
    } catch (error) {
      logger.error('Health check error:', {
        error: error.message,
        stack: error.stack
      });
      
      res.status(503).json({
        status: 'DOWN',
        error: error.message,
        timestamp: new Date()
      });
    }
  });
}

/**
 * Check database health
 * @returns {Promise<string>} - Database status
 */
async function checkDatabaseHealth() {
  try {
    await sequelize.authenticate({ logging: false });
    return 'Connected';
  } catch (error) {
    logger.warn('Database health check failed:', {
      error: error.message
    });
    return `Disconnected: ${error.message}`;
  }
}

/**
 * Start the server and initialize services
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    // Environment detection for services
    const isDocker = fs.existsSync('/.dockerenv') || process.env.RUNNING_IN_DOCKER === 'true';
    
    // Default host values based on environment
    const defaultRedisHost = isDocker ? 'redis' : 'localhost';
    const defaultPostgresHost = isDocker ? 'postgres' : 'localhost';
    
    // Connect to PostgreSQL
    await connectToDatabase();
    logger.info('Database connection established', {
      host: process.env.POSTGRES_HOST || defaultPostgresHost,
      database: process.env.POSTGRES_DB || 'runl_events'
    });
    
    // Configure and connect to Redis
    await redisService
      .configure({
        host: process.env.REDIS_HOST || defaultRedisHost,
        port: process.env.REDIS_PORT || 6379,
        maxReconnectAttempts: 10,
        initialBackoff: 100,
        maxBackoff: 10000
      })
      .connect();
    
    // Initialize event forwarding system
    await initializeEventSystem();
    
    // Initialize Express app
    await initializeApp();
    
    // Create HTTP server from Express app
    const http = require('http');
    const server = http.createServer(app);
    
    // Initialize WebSocket server
    await websocketService.initialize(server);
    
    // Determine client origin for logging
    let clientOrigin = 'auto-detect';
    if (process.env.CLIENT_ORIGIN) {
      clientOrigin = process.env.CLIENT_ORIGIN;
      if (clientOrigin.includes(',')) {
        clientOrigin = `multiple origins (${clientOrigin.split(',').length})`;
      }
    } else if (process.env.CORS_ALLOW_ALL === 'true') {
      clientOrigin = 'all origins (CORS_ALLOW_ALL=true)';
    }
    
    // Start listening
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} with WebSocket support`);
      logger.info(`Environment: ${isDocker ? 'Docker' : 'Standard'}`);
      logger.info(`Accepting client connections from: ${clientOrigin}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', {
      error: error.message,
      stack: error.stack
    });
    await performGracefulShutdown();
    process.exit(1);
  }
}

/**
 * Initialize event routing system
 * @returns {Promise<void>}
 */
async function initializeEventSystem() {
  try {
    logger.info('Initializing event forwarding system...');
    
    // 1. First ensure transformerService is loaded
    logger.info('Transformer service loaded with supported types:', Object.keys(transformerService.transformers));
    
    // 2. Load destinations from database to webhook forwarder
    try {
      await loadDestinationsFromDatabase();
      logger.info('Destinations loaded into webhook forwarder');
    } catch (error) {
      logger.error('Failed to load destinations:', {
        error: error.message,
        stack: error.stack
      });
      // Continue even if destinations fail to load
    }
    
    // 3. Initialize event router (loads active routes)
    try {
      await eventRouter.initialize();
      logger.info('Event Router initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Event Router:', {
        error: error.message,
        stack: error.stack
      });
      // Continue even if Event Router fails
    }
  } catch (error) {
    logger.error('Error initializing event system:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Perform graceful shutdown of all services
 * @returns {Promise<void>}
 */
async function performGracefulShutdown() {
  logger.info('Performing graceful shutdown...');
  
  // Close Redis connection
  try {
    await redisService.disconnect();
    logger.info('Redis connection closed');
  } catch (redisError) {
    logger.error('Error closing Redis connection:', {
      error: redisError.message
    });
  }
  
  // Close database connection
  try {
    await closeConnection();
    logger.info('Database connection closed');
  } catch (dbError) {
    logger.error('Error closing database connection:', {
      error: dbError.message
    });
  }
  
  logger.info('Graceful shutdown completed');
}

// Add graceful shutdown handlers
process.on('SIGTERM', handleShutdownSignal);
process.on('SIGINT', handleShutdownSignal);

/**
 * Handle shutdown signals
 */
async function handleShutdownSignal() {
  logger.info('Received shutdown signal, closing connections gracefully...');
  
  try {
    await performGracefulShutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Start the server
startServer();