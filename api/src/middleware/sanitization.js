const xss = require('xss');
const logger = require('../utils/logger');

/**
 * Sanitizes request body, query parameters, and URL parameters to prevent XSS attacks
 * This middleware should be applied before validation to ensure clean data is validated
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const sanitizeMiddleware = (req, res, next) => {
  try {
    // Apply sanitization to different parts of the request
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    
    // Sanitize specific headers that might contain user input
    sanitizeHeaders(req);

    logger.debug('Request sanitization complete', { 
      path: req.path,
      method: req.method
    });
    
    next();
  } catch (error) {
    logger.error('Sanitization error:', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method
    });
    
    // Pass the error to the error handler middleware
    next(error);
  }
};

/**
 * Sanitize specific HTTP headers that may contain user input
 * @private
 * @param {Object} req - Express request object
 */
function sanitizeHeaders(req) {
  // Only sanitize specific headers that might contain user input
  const headersToSanitize = ['referer', 'user-agent'];
  
  try {
    headersToSanitize.forEach(header => {
      if (req.headers[header]) {
        req.headers[header] = sanitizeString(req.headers[header]);
      }
    });
  } catch (error) {
    logger.warn(`Error sanitizing headers: ${error.message}`);
    // Continue execution - header sanitization is not critical
  }
}

/**
 * Sanitizes specific nested JSON paths that might contain HTML
 * Useful for sanitizing only specific fields in complex objects
 * 
 * @param {Array} paths - Array of dot notation paths to sanitize (e.g., ['data.html', 'properties.description'])
 * @returns {Function} - Express middleware function
 */
const sanitizeJsonPaths = (paths = []) => {
  return (req, res, next) => {
    try {
      // Only process if we have a body
      if (!req.body) {
        return next();
      }
      
      for (const path of paths) {
        try {
          const value = getNestedValue(req.body, path);
          
          if (typeof value === 'string') {
            setNestedValue(req.body, path, sanitizeString(value));
          }
        } catch (pathError) {
          logger.debug(`Error sanitizing path ${path}:`, pathError);
          // Continue with other paths
        }
      }
      
      next();
    } catch (error) {
      logger.error('JSON path sanitization error:', {
        error: error.message,
        stack: error.stack,
        paths: paths,
        path: req.path
      });
      next(error);
    }
  };
};

/**
 * Sanitize a string using XSS library
 * @private
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') {
    return str;
  }
  
  return xss(str, {
    whiteList: {}, // No tags allowed
    stripIgnoreTag: true, // Strip ignored tags
    stripIgnoreTagBody: ['script'] // Remove script tag contents
  });
}

/**
 * Recursively sanitize an object to prevent XSS attacks
 * @private
 * @param {*} obj - Object to sanitize
 * @returns {*} - Sanitized object
 */
function sanitizeObject(obj) {
  // Handle null, undefined, and primitive types
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  // Handle objects
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }
  
  return sanitized;
}

/**
 * Get a value from a nested path using dot notation
 * @private
 * @param {Object} obj - Object to get value from
 * @param {string} path - Dot notation path
 * @returns {*} - Value at the path or undefined
 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Set a value at a nested path using dot notation
 * @private
 * @param {Object} obj - Object to set value in
 * @param {string} path - Dot notation path
 * @param {*} value - Value to set
 */
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }
  
  current[parts[parts.length - 1]] = value;
}

module.exports = {
  sanitizeMiddleware,
  sanitizeJsonPaths
};