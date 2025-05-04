const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * API key authentication middleware
 * Verifies that the request includes a valid API key
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const apiKeyAuth = (req, res, next) => {
  try {
    // Extract API key from headers (with multiple possible header names)
    const apiKey = extractApiKey(req);
    
    // Check if API key exists and matches
    if (!isValidApiKey(apiKey)) {
      logAuthFailure(req, apiKey);
      
      return res.status(401).json({
        error: true,
        message: 'Unauthorized: Invalid or missing API key'
      });
    }
    
    // API key is valid, log success (debug level only)
    logger.debug('API key authentication successful', {
      path: req.path,
      method: req.method,
      ip: anonymizeIp(req.ip)
    });
    
    // Store authentication info in request for downstream middleware/routes
    req.auth = {
      authenticated: true,
      method: 'api_key',
      timestamp: new Date()
    };
    
    next();
  } catch (error) {
    logger.error('Authentication error:', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: anonymizeIp(req.ip)
    });
    
    // Always return 401 on auth errors for security
    res.status(401).json({
      error: true,
      message: 'Authentication error'
    });
  }
};

/**
 * Extract API key from request headers
 * Checks multiple common header formats
 * 
 * @private
 * @param {Object} req - Express request object
 * @returns {string|null} - API key or null if not found
 */
function extractApiKey(req) {
  // Check multiple possible header names (in order of preference)
  const headerNames = [
    'x-api-key',
    'api-key',
    'authorization'
  ];
  
  for (const header of headerNames) {
    const value = req.headers[header];
    
    if (value) {
      // For Authorization header, check if it's a Bearer token format
      if (header === 'authorization' && value.startsWith('Bearer ')) {
        return value.substring(7); // Remove 'Bearer ' prefix
      }
      
      return value;
    }
  }
  
  return null;
}

/**
 * Validate the provided API key
 * 
 * @private
 * @param {string|null} apiKey - API key to validate
 * @returns {boolean} - Whether the API key is valid
 */
function isValidApiKey(apiKey) {
  if (!apiKey) {
    return false;
  }
  
  // Get configured API key from environment
  const configuredApiKey = process.env.API_KEY;
  
  if (!configuredApiKey) {
    logger.warn('API_KEY not configured in environment');
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  // This is more secure than a simple equality check
  return crypto.timingSafeEqual(
    Buffer.from(apiKey),
    Buffer.from(configuredApiKey)
  );
}

/**
 * Log authentication failure
 * 
 * @private
 * @param {Object} req - Express request object
 * @param {string|null} apiKey - The API key that was provided (or null)
 */
function logAuthFailure(req, apiKey) {
  logger.warn('API key authentication failed', {
    ip: anonymizeIp(req.ip),
    path: req.path,
    method: req.method,
    keyProvided: apiKey ? 'yes' : 'no',
    userAgent: req.headers['user-agent']
  });
}

/**
 * Anonymize IP address for privacy
 * 
 * @private
 * @param {string} ip - IP address to anonymize
 * @returns {string} - Anonymized IP address
 */
function anonymizeIp(ip) {
  if (!ip) return 'unknown';
  
  // For IPv4, remove last octet
  if (ip.includes('.')) {
    return ip.replace(/\d+$/, 'xxx');
  }
  
  // For IPv6, remove last segment
  if (ip.includes(':')) {
    return ip.replace(/:[^:]+$/, ':xxxx');
  }
  
  return ip;
}

module.exports = apiKeyAuth;