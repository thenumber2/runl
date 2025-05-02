const { rateLimit } = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Configure rate limiting with enhanced logging
 * @param {Object} options Custom rate limit options
 * @returns {Function} Configured rate limit middleware
 */
const configureRateLimit = (options = {}) => {
  const defaultOptions = {
    windowMs: 60 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        requestId: req.headers['x-request-id'] || 'unknown',
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        error: true,
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
    }
  };

  // Merge custom options with defaults
  const mergedOptions = { ...defaultOptions, ...options };
  return rateLimit(mergedOptions);
};

/**
 * Default rate limiter for all routes
 */
const defaultRateLimiter = configureRateLimit();

/**
 * Stricter rate limiter for sensitive routes (e.g., login, registration)
 */
const sensitiveRateLimiter = configureRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  message: 'Too many attempts. Please try again later.'
});

module.exports = {
  configureRateLimit,
  defaultRateLimiter,
  sensitiveRateLimiter
};