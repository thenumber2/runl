const logger = require('../utils/logger');
const { Server } = require('socket.io');
const Event = require('../models/Event');
const { sequelize } = require('../db/connection');

/**
 * WebSocket Service
 * Handles real-time event streaming to clients
 */
class WebSocketService {
  constructor() {
    this.io = null;
    this.authenticatedSockets = new Map(); // Map of socket.id to { socket, apiKey, filters }
    this.initialized = false;
  }

  /**
   * Initialize WebSocket server with an HTTP server
   * @param {Object} server - HTTP server instance
   * @returns {Promise<void>}
   */
  async initialize(server) {
    if (this.initialized) {
      logger.warn('WebSocket server already initialized');
      return;
    }

    try {
      logger.info('Initializing WebSocket server');

      // Default allowed origins that work in both Docker and non-Docker environments
      const defaultOrigins = [
        // Docker container references
        'http://runl-client:3001',
        'https://runl-client:3001',
        
        // Local development
        'http://localhost:3001',
        'https://localhost:3001',
        'http://127.0.0.1:3001',
        'https://127.0.0.1:3001',
        
        // Common development ports
        'http://localhost:3000',
        'https://localhost:3000',
        'http://localhost:8080',
        'https://localhost:8080'
      ];
      
      // Get allowed origins from environment variable if available
      let allowedOrigins = [];
      
      if (process.env.CLIENT_ORIGIN) {
        // Support both comma-separated list and single value
        if (process.env.CLIENT_ORIGIN.includes(',')) {
          allowedOrigins = process.env.CLIENT_ORIGIN.split(',').map(origin => origin.trim());
        } else {
          allowedOrigins = [process.env.CLIENT_ORIGIN];
        }
      }
      
      // Combine default and environment-provided origins, removing duplicates
      allowedOrigins = [...new Set([...defaultOrigins, ...allowedOrigins])];
      
      logger.info('WebSocket server configured with CORS origins:', { allowedOrigins });

      // Configure Socket.IO with options that work in both Docker and non-Docker environments
      this.io = new Server(server, {
        cors: {
          origin: (origin, callback) => {
            // Allow all origins if CORS_ALLOW_ALL is true
            if (process.env.CORS_ALLOW_ALL === 'true') {
              callback(null, true);
              return;
            }
            
            // Allow requests with no origin
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              logger.warn(`WebSocket blocked connection from origin: ${origin}`);
              callback(new Error(`Origin ${origin} not allowed by CORS`));
            }
          },
          methods: ['GET', 'POST'],
          credentials: true,
          allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'api-key', 'x-api-key']
        },
        path: '/socket.io',
        // Connection parameters that work well in all environments
        transports: ['websocket', 'polling'],
        pingTimeout: 30000,
        pingInterval: 25000,
        // Don't close connections right away if there's a temporary network issue
        connectTimeout: 45000
      });

      // Set up connection handler
      this.io.on('connection', (socket) => this.handleConnection(socket));

      this.initialized = true;
      logger.info('WebSocket server initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WebSocket server:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Handle new socket connections
   * @private
   * @param {Object} socket - Socket.io socket
   */
  handleConnection(socket) {
    logger.info('New WebSocket connection:', { socketId: socket.id });

    // Handle authentication
    socket.on('authenticate', async (apiKey) => {
      try {
        await this.handleAuthentication(socket, apiKey);
      } catch (error) {
        logger.error('Error in authenticate handler:', {
          error: error.message,
          stack: error.stack,
          socketId: socket.id
        });
        socket.emit('auth_error', { message: 'Authentication failed' });
      }
    });

    // Handle filter updates
    socket.on('setFilters', async (filters) => {
      try {
        await this.handleSetFilters(socket, filters);
      } catch (error) {
        logger.error('Error in setFilters handler:', {
          error: error.message,
          stack: error.stack,
          socketId: socket.id
        });
        socket.emit('error', { message: 'Failed to update filters' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      try {
        this.handleDisconnect(socket);
      } catch (error) {
        logger.error('Error in disconnect handler:', {
          error: error.message,
          stack: error.stack,
          socketId: socket.id
        });
      }
    });

    // Set a timeout for authentication
    setTimeout(() => {
      if (!this.authenticatedSockets.has(socket.id)) {
        logger.warn('Socket authentication timeout - closing connection', { socketId: socket.id });
        socket.disconnect();
      }
    }, 30000); // 30 seconds timeout for authentication
  }

  /**
   * Authenticate a socket connection
   * @private
   * @param {Object} socket - Socket.io socket
   * @param {string} apiKey - API key for authentication
   * @returns {Promise<void>}
   */
  async handleAuthentication(socket, apiKey) {
    try {
      // Validate API key (simplified - in production, use your apiKeyAuth middleware)
      const isValid = apiKey === process.env.API_KEY;

      if (!isValid) {
        logger.warn('Invalid API key provided for WebSocket authentication', { socketId: socket.id });
        socket.emit('auth_error', { message: 'Invalid API key' });
        return;
      }

      // Store authenticated socket with default filters
      this.authenticatedSockets.set(socket.id, {
        socket,
        apiKey,
        filters: {
          page: 1,
          limit: 20
        }
      });

      // Send authenticated event
      socket.emit('authenticated');
      logger.info('Socket authenticated successfully', { socketId: socket.id });

      // Send initial events
      await this.sendEventsToSocket(socket);
    } catch (error) {
      logger.error('Error during WebSocket authentication:', {
        error: error.message,
        stack: error.stack,
        socketId: socket.id
      });
      socket.emit('auth_error', { message: 'Authentication error' });
      throw error; // Re-throw to be caught by the caller
    }
  }

  /**
   * Update filters for a socket
   * @private
   * @param {Object} socket - Socket.io socket
   * @param {Object} filters - Event filters
   * @returns {Promise<void>}
   */
  async handleSetFilters(socket, filters) {
    try {
      const socketData = this.authenticatedSockets.get(socket.id);
      
      if (!socketData) {
        logger.warn('Unauthenticated socket tried to set filters', { socketId: socket.id });
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      // Update stored filters
      socketData.filters = { ...socketData.filters, ...filters };
      this.authenticatedSockets.set(socket.id, socketData);
      
      logger.debug('Updated socket filters', { socketId: socket.id, filters: socketData.filters });
      
      // Fetch and send events with new filters
      await this.sendEventsToSocket(socket);
    } catch (error) {
      logger.error('Error in handleSetFilters:', {
        error: error.message,
        stack: error.stack,
        socketId: socket.id
      });
      socket.emit('error', { message: 'Failed to update filters' });
      throw error; // Re-throw to be caught by the caller
    }
  }

  /**
   * Handle socket disconnection
   * @private
   * @param {Object} socket - Socket.io socket
   */
  handleDisconnect(socket) {
    logger.info('WebSocket disconnected', { socketId: socket.id });
    this.authenticatedSockets.delete(socket.id);
  }

  /**
   * Send events to a specific socket based on its filters
   * @private
   * @param {Object} socket - Socket.io socket
   * @returns {Promise<void>}
   */
  async sendEventsToSocket(socket) {
    try {
      const socketData = this.authenticatedSockets.get(socket.id);
      
      if (!socketData) {
        logger.warn('Tried to send events to unauthenticated socket', { socketId: socket.id });
        return;
      }

      const { filters } = socketData;
      
      // Build query conditions from filters
      const whereClause = {};
      if (filters.eventName) {
        whereClause.eventName = filters.eventName;
      }
      
      // Add userId filter if provided
      if (filters.userId) {
        whereClause[sequelize.Op.and] = sequelize.where(
          sequelize.json('properties.userId'),
          '=',
          filters.userId
        );
      }
      
      // Add date range filters if provided
      if (filters.startDate || filters.endDate) {
        whereClause.timestamp = {};
        
        if (filters.startDate) {
          whereClause.timestamp[sequelize.Op.gte] = new Date(filters.startDate);
        }
        
        if (filters.endDate) {
          whereClause.timestamp[sequelize.Op.lte] = new Date(filters.endDate);
        }
      }
      
      // Query with pagination
      const { count, rows } = await Event.findAndCountAll({
        where: whereClause,
        limit: filters.limit || 20,
        offset: ((filters.page || 1) - 1) * (filters.limit || 20),
        order: [['timestamp', 'DESC']]
      });
      
      // Send events to socket
      socket.emit('events', {
        success: true,
        count,
        totalPages: Math.ceil(count / (filters.limit || 20)),
        currentPage: filters.page || 1,
        data: rows
      });
    } catch (error) {
      logger.error('Error fetching events for socket:', {
        error: error.message,
        stack: error.stack,
        socketId: socket.id
      });
      socket.emit('error', { message: 'Failed to fetch events' });
      throw error; // Re-throw to be caught by the caller
    }
  }

  /**
   * Broadcast an event to all connected clients whose filters match
   * @param {Object} event - The event to broadcast
   * @returns {Promise<number>} - Number of clients the event was sent to
   */
  async broadcastEvent(event) {
    try {
      if (!this.initialized || !this.io) {
        return 0;
      }

      let sentCount = 0;
      const broadcastPromises = [];

      // Process each authenticated socket
      for (const [socketId, socketData] of this.authenticatedSockets.entries()) {
        const { socket, filters } = socketData;
        
        // Check if event matches socket's filters
        if (this.eventMatchesFilters(event, filters)) {
          // Use a promise to handle potential async issues with socket.emit
          const broadcastPromise = new Promise((resolve) => {
            socket.emit('newEvent', event);
            resolve(socketId);
          }).catch(error => {
            logger.error('Error broadcasting event to socket:', {
              error: error.message,
              socketId,
              eventId: event.id
            });
            return null; // Return null for failed broadcasts
          });
          
          broadcastPromises.push(broadcastPromise);
        }
      }

      // Wait for all broadcast operations to complete
      const results = await Promise.all(broadcastPromises);
      sentCount = results.filter(result => result !== null).length;

      if (sentCount > 0) {
        logger.debug(`Broadcasted event to ${sentCount} clients`, { eventId: event.id });
      }

      return sentCount;
    } catch (error) {
      logger.error('Error broadcasting event:', {
        error: error.message,
        stack: error.stack,
        eventId: event?.id
      });
      return 0;
    }
  }

  /**
   * Check if an event matches a socket's filters
   * @private
   * @param {Object} event - Event to check
   * @param {Object} filters - Socket filters
   * @returns {boolean} - Whether the event matches
   */
  eventMatchesFilters(event, filters) {
    // Match event name if specified
    if (filters.eventName && event.eventName !== filters.eventName) {
      return false;
    }
    
    // Match user ID if specified
    if (filters.userId && event.properties?.userId !== filters.userId) {
      return false;
    }
    
    // Match date range if specified
    if (filters.startDate || filters.endDate) {
      const eventDate = new Date(event.timestamp);
      
      if (filters.startDate && eventDate < new Date(filters.startDate)) {
        return false;
      }
      
      if (filters.endDate && eventDate > new Date(filters.endDate)) {
        return false;
      }
    }
    
    // Event passed all filters
    return true;
  }
}

// Export singleton instance
module.exports = new WebSocketService();