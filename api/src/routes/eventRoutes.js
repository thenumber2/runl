const eventController = require('../controllers/eventController');
const { validate } = require('../middleware/validation');
const { eventSchema } = require('../middleware/eventValidation');
const { cacheMiddleware } = require('../services/redis');

// Setup event routes
const setupEventRoutes = (apiRouter) => {
  // Log event endpoint
  apiRouter.post('/events', 
    validate(eventSchema), 
    eventController.logEvent
  );
  
  // Get all events with pagination and filtering
  apiRouter.get('/events', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEvents
  );
  
  // Search events by property
  apiRouter.get('/events/search', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.searchEvents
  );
  
  // Get events by user ID - this route must come before the /:id route
  apiRouter.get('/events/user/:userId', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEventsByUserId
  );
  
  // Get event by ID
  apiRouter.get('/events/:id', 
    cacheMiddleware(60), // Cache for 1 minute
    eventController.getEventById
  );
};

module.exports = setupEventRoutes;