require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const { setupRoutes } = require('./routes');
const { connectToDatabase } = require('./db/connection');
const { setupRedis } = require('./services/redis');
const logger = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitization'); // Import sanitization middleware

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json({ limit: '10mb' })); // Parse JSON requests
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded requests
app.use(morgan('combined')); // Request logging

// Add sanitization middleware - must be after body parsing but before routes
app.use(sanitizeMiddleware); // Apply sanitization to all routes

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'UP', timestamp: new Date() });
});

// Setup API routes
setupRoutes(app);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`, { stack: err.stack });
  
  res.status(err.statusCode || 500).json({
    error: true,
    message: err.message || 'An unexpected error occurred',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

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

startServer();