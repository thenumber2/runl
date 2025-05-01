const eventController = require('../controllers/eventController');
const validate = require('../middleware/validation');
const { eventSchema } = require('../middleware/eventValidation');
const { cacheMiddleware } = require('../services/redis');
const apiKeyAuth = require('../middleware/auth');
const { sanitizeJsonPaths } = require('../middleware/sanitization');

// Setup event routes
const setupEventRoutes = (apiRouter) => {
  // Apply API key authentication to all event routes
  const eventRouter = require('express').Router();
  eventRouter.use(apiKeyAuth);
  
  // Log event endpoint with targeted sanitization for specific fields
  eventRouter.post('/', 
    // Sanitize specific JSON paths that might contain user input with HTML
    sanitizeJsonPaths(['properties.message', 'properties.userInput', 'properties.description']),
    validate(eventSchema), 
    eventController.logEvent
  );
  
  // Get all events with pagination and filtering
  eventRouter.get('/', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEvents
  );
  
  // Search events by property
  eventRouter.get('/search', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.searchEvents
  );
  
  // Get events by user ID - this route must come before the /:id route
  eventRouter.get('/user/:userId', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEventsByUserId
  );
  
  // Get event by ID
  eventRouter.get('/:id', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEventById
  );
  
  // Mount the event routes
  apiRouter.use('/events', eventRouter);
};

module.exports = setupEventRoutes;