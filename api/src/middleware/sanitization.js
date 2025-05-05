const xss = require('xss');
const logger = require('../utils/logger');

/**
 * Sanitizes request body, query parameters, and URL parameters to prevent XSS attacks
 * This middleware should be applied before validation to ensure clean data is validated
 */
const sanitizeMiddleware = (req, res, next) => {
  try {
    // Function to recursively sanitize objects
    const sanitizeObject = (obj) => {
      if (!obj) return obj;
      
      if (typeof obj === 'string') {
        return xss(obj, {
          whiteList: {}, // No tags allowed
          stripIgnoreTag: true, // Strip ignored tags
          stripIgnoreTagBody: ['script'] // Remove script tag contents
        });
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }
      
      if (typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      
      return obj; // Return as is for numbers, booleans, etc.
    };
    
    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    
    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    
    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    
    // Sanitize headers (optionally, be careful with authentication headers)
    // Only sanitize specific headers that might contain user input
    const headersToSanitize = ['referer', 'user-agent'];
    headersToSanitize.forEach(header => {
      if (req.headers[header]) {
        req.headers[header] = sanitizeObject(req.headers[header]);
      }
    });

    logger.debug('Request sanitization complete', { 
      path: req.path,
      method: req.method
    });
    
    next();
  } catch (error) {
    logger.error('Sanitization error:', error);
    next(error);
  }
};

/**
 * Sanitizes specific nested JSON paths that might contain HTML
 * Useful for sanitizing only specific fields in complex objects
 * @param {Array} paths - Array of dot notation paths to sanitize (e.g., ['data.html', 'properties.description'])
 */
const sanitizeJsonPaths = (paths = []) => {
  return (req, res, next) => {
    try {
      // Only process if we have a body
      if (!req.body) {
        return next();
      }
      
      const getNestedValue = (obj, path) => {
        const parts = path.split('.');
        let current = obj;
        
        for (const part of parts) {
          if (current === null || current === undefined) {
            return undefined;
          }
          current = current[part];
        }
        
        return current;
      };
      
      const setNestedValue = (obj, path, value) => {
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
      };
      
      // Process each path
      for (const path of paths) {
        const value = getNestedValue(req.body, path);
        
        if (typeof value === 'string') {
          const sanitized = xss(value, {
            whiteList: {}, // No tags allowed
            stripIgnoreTag: true,
            stripIgnoreTagBody: ['script']
          });
          
          setNestedValue(req.body, path, sanitized);
        }
      }
      
      next();
    } catch (error) {
      logger.error('JSON path sanitization error:', error);
      next(error);
    }
  };
};

module.exports = {
  sanitizeMiddleware,
  sanitizeJsonPaths
};