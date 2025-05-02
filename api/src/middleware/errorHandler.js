const logger = require('../utils/logger');

/**
 * Global error handling middleware
 * Logs errors and sends appropriate response to client
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  
  // Log with additional context
  logger.error(`Error: ${err.message}`, { 
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    statusCode,
    requestId: req.headers['x-request-id'] || 'unknown'
  });
  
  res.status(statusCode).json({
    error: true,
    message: err.message || 'An unexpected error occurred',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

/**
 * 404 handler for routes that weren't matched
 */
const notFoundHandler = (req, res) => {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  res.status(404).json({
    error: true,
    message: 'Route not found'
  });
};

module.exports = {
  errorHandler,
  notFoundHandler
};