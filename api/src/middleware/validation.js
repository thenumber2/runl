const logger = require('../utils/logger');

/**
 * Generic validation middleware
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn(`Validation error: ${errorMessage}`, { 
        path: req.path, 
        body: req.body 
      });
      
      return res.status(400).json({
        error: true,
        message: 'Validation failed',
        details: error.details
      });
    }
    
    next();
  };
};

module.exports = validate;