const logger = require('../utils/logger');

/**
 * Simple API key authentication middleware
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // Check if API key exists and matches
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn('API key authentication failed', {
      ip: req.ip,
      path: req.path
    });
    
    return res.status(401).json({
      error: true,
      message: 'Unauthorized: Invalid or missing API key'
    });
  }
  
  // API key is valid, proceed
  logger.debug('API key authentication successful', {
    path: req.path
  });
  
  next();
};

module.exports = apiKeyAuth;