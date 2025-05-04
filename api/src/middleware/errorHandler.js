const logger = require('../utils/logger');

/**
 * Global error handling middleware
 * Logs errors and sends appropriate response to client
 * 
 * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  try {
    // Default to 500 if statusCode is not set
    const statusCode = err.statusCode || 500;
    
    // Create a structured error context for logging
    const errorContext = {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      statusCode,
      requestId: req.headers['x-request-id'] || 'unknown',
      userId: req.user?.id || 'anonymous',
      query: sanitizeObject(req.query),
      body: sanitizeObject(req.body),
      params: req.params
    };
    
    // Log different levels based on status code
    if (statusCode >= 500) {
      logger.error(`Server Error (${statusCode}): ${err.message}`, errorContext);
    } else if (statusCode >= 400) {
      logger.warn(`Client Error (${statusCode}): ${err.message}`, errorContext);
    } else {
      logger.info(`Other Error (${statusCode}): ${err.message}`, errorContext);
    }
    
    // Prepare client response
    const response = {
      error: true,
      message: err.message || 'An unexpected error occurred'
    };
    
    // Only include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      response.stack = err.stack;
    }
    
    // Include validation errors if available
    if (err.errors && Array.isArray(err.errors)) {
      response.errors = err.errors.map(e => ({
        path: e.path,
        message: e.message
      }));
    }
    
    // Send JSON response
    res.status(statusCode).json(response);
  } catch (handlerError) {
    // Error in the error handler itself - last resort logging and response
    logger.error('Error in errorHandler middleware:', {
      originalError: {
        message: err.message,
        stack: err.stack
      },
      handlerError: {
        message: handlerError.message,
        stack: handlerError.stack
      }
    });
    
    // Send a simplified response since the main handler failed
    res.status(500).json({
      error: true,
      message: 'Internal Server Error'
    });
  }
};

/**
 * 404 handler for routes that weren't matched
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const notFoundHandler = (req, res) => {
  try {
    logger.warn('Route not found', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      requestId: req.headers['x-request-id'] || 'unknown',
      query: sanitizeObject(req.query)
    });
    
    res.status(404).json({
      error: true,
      message: 'Route not found'
    });
  } catch (error) {
    // Failsafe in case the 404 handler itself has an error
    logger.error('Error in notFoundHandler middleware:', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });
    
    res.status(500).json({
      error: true,
      message: 'Internal Server Error'
    });
  }
};

/**
 * Async handler wrapper for route handlers
 * Catches async errors and passes them to the global error handler
 * 
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Wrapped handler that properly catches async errors
 */
const asyncErrorWrapper = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Sanitize sensitive data in objects for logging
 * 
 * @private
 * @param {Object} obj - The object to sanitize
 * @returns {Object} - Sanitized object
 */
function sanitizeObject(obj) {
  if (!obj) return obj;
  
  // Create a deep copy to avoid modifying the original
  const sanitized = JSON.parse(JSON.stringify(obj));
  
  // List of sensitive fields to redact
  const sensitiveFields = [
    'password', 'token', 'secret', 'apiKey', 'key', 
    'authorization', 'credentials', 'credit_card'
  ];
  
  // Recursively sanitize the object
  const sanitizeRecursive = (object) => {
    if (!object || typeof object !== 'object') return;
    
    Object.keys(object).forEach(key => {
      // Check if this key contains a sensitive field name
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        object[key] = '[REDACTED]';
      } else if (typeof object[key] === 'object') {
        // Recursively sanitize nested objects
        sanitizeRecursive(object[key]);
      }
    });
  };
  
  sanitizeRecursive(sanitized);
  return sanitized;
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncErrorWrapper
};