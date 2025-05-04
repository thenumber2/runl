const express = require('express');
const stripeWebhookController = require('../controllers/stripeWebhookController');
const logger = require('../utils/logger');
const apiKeyAuth = require('../middleware/auth');

/**
 * Raw body buffer middleware for Stripe webhooks
 * This captures the raw request body needed for Stripe signature verification
 */
const rawBodyMiddleware = (req, res, next) => {
  let data = '';
  
  // Skip this middleware if not a stripe webhook request
  if (req.path !== '/stripe/webhook') {
    return next();
  }

  req.rawBody = '';
  
  req.on('data', chunk => {
    req.rawBody += chunk.toString();
  });
  
  req.on('end', () => {
    // Parse the raw body as JSON only after capturing the raw content
    try {
      if (req.rawBody) {
        req.body = JSON.parse(req.rawBody);
      }
      next();
    } catch (error) {
      logger.error('Error parsing Stripe webhook payload', { error });
      res.status(400).send('Webhook Error: Invalid payload');
    }
  });
};

// Setup integration routes
const setupIntegrationRoutes = (apiRouter) => {
  const integrationRouter = express.Router();
  
  // Apply raw body middleware specific to this router
  integrationRouter.use(rawBodyMiddleware);
  
  // Stripe webhook endpoint - NO API KEY AUTH for this route!
  // Stripe uses its own signature verification
  integrationRouter.post(
    '/stripe/webhook',
    stripeWebhookController.handleStripeWebhook
  );
  
  // Routes that require API key auth
  // These are admin/management routes for the integration
  integrationRouter.use(apiKeyAuth);
  
  // Reprocess failed Stripe events
  integrationRouter.post(
    '/stripe/reprocess',
    stripeWebhookController.reprocessFailedEvents
  );
  
  // Get Stripe event statistics
  integrationRouter.get(
    '/stripe/stats',
    stripeWebhookController.getStripeEventStats
  );
  
  // Mount the integration routes
  apiRouter.use('/integrations', integrationRouter);
  
  logger.info('Integration routes initialized');
};

module.exports = setupIntegrationRoutes;