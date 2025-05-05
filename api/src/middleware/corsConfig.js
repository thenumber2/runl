const cors = require('cors');
const logger = require('../utils/logger');

/**
 * Configure CORS with proper settings that work in both Docker and non-Docker environments
 * @returns {Function} Configured CORS middleware
 */
function configureCors() {
  // Default allowed origins that work in both Docker and non-Docker environments
  const defaultOrigins = [
    // Docker container references
    'http://runl-client:3001',
    'https://runl-client:3001',
    
    // Local development
    'http://localhost:3001',
    'https://localhost:3001',
    'http://127.0.0.1:3001',
    'https://127.0.0.1:3001',
    
    // Common development ports
    'http://localhost:3000',
    'https://localhost:3000',
    'http://localhost:8080',
    'https://localhost:8080'
  ];
  
  // Get allowed origins from environment variable if available
  let allowedOrigins = [];
  
  if (process.env.CLIENT_ORIGIN) {
    // Support both comma-separated list and single value
    if (process.env.CLIENT_ORIGIN.includes(',')) {
      allowedOrigins = process.env.CLIENT_ORIGIN.split(',').map(origin => origin.trim());
    } else {
      allowedOrigins = [process.env.CLIENT_ORIGIN];
    }
  }
  
  // Combine default and environment-provided origins, removing duplicates
  allowedOrigins = [...new Set([...defaultOrigins, ...allowedOrigins])];
  
  const corsOptions = {
    origin: (origin, callback) => {
      // Allow all origins if CORS_ALLOW_ALL is true (development convenience)
      if (process.env.CORS_ALLOW_ALL === 'true') {
        callback(null, true);
        return;
      }
      
      // Allow requests with no origin (like mobile apps, curl, or Postman requests)
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'api-key', 'x-api-key', 'x-request-id']
  };
  
  // Log the CORS configuration on startup
  if (process.env.CORS_ALLOW_ALL === 'true') {
    logger.info('CORS configured to allow all origins (not recommended for production)');
  } else {
    logger.info('CORS configured with allowed origins:', { allowedOrigins });
  }
  
  return cors(corsOptions);
}

module.exports = configureCors;