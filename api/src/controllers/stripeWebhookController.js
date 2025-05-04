const asyncHandler = require('express-async-handler');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const StripeEvent = require('../models/StripeEvent');
const logger = require('../utils/logger');
const { sequelize } = require('../db/connection');

/**
 * Handle Stripe webhook events
 * @route POST /api/integrations/stripe/webhook
 */
const handleStripeWebhook = asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    // Verify the event came from Stripe
    const event = stripe.webhooks.constructEvent(
      req.rawBody, // Using raw body for signature verification
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    // Check if this event has already been processed (idempotency)
    const existingEvent = await StripeEvent.findOne({
      where: { stripeEventId: event.id }
    });
    
    if (existingEvent) {
      logger.info(`Duplicate Stripe event received: ${event.id}`);
      // Immediately return success response to Stripe
      return res.status(200).json({ received: true, duplicate: true });
    }
    
    // Start a transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Extract base object info from the event
      const object = event.data.object;
      const objectType = object.object; // Stripe includes 'object' property with type
      
      // Store the event in the database
      const storedEvent = await StripeEvent.create({
        stripeEventId: event.id,
        stripeEventType: event.type,
        stripeEventCreated: new Date(event.created * 1000),
        stripeAccount: event.account,
        stripeApiVersion: event.api_version,
        objectId: object.id,
        objectType: objectType,
        data: event,
        processed: false
      }, { transaction });
      
      // Process the event based on its type
      let processingError = null;
      
      try {
        switch (event.type) {
          case 'payment_intent.succeeded':
            await handlePaymentIntentSucceeded(event, transaction);
            break;
          case 'payment_intent.payment_failed':
            await handlePaymentIntentFailed(event, transaction);
            break;
          case 'invoice.paid':
            await handleInvoicePaid(event, transaction);
            break;
          case 'invoice.payment_failed':
            await handleInvoicePaymentFailed(event, transaction);
            break;
          case 'customer.subscription.created':
            await handleSubscriptionCreated(event, transaction);
            break;
          case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event, transaction);
            break;
          case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event, transaction);
            break;
          default:
            // Just log unknown event types
            logger.info(`Received unhandled Stripe event: ${event.type}`, {
              stripeEventId: event.id
            });
        }
        
        // Mark the event as processed
        await storedEvent.update({
          processed: true,
          processedAt: new Date()
        }, { transaction });
        
      } catch (processingErr) {
        // Capture processing error but don't fail the transaction
        processingError = processingErr;
        logger.error(`Error processing Stripe event ${event.id}:`, {
          error: processingErr.message,
          stack: processingErr.stack,
          eventType: event.type
        });
        
        // Update the event with error information
        await storedEvent.update({
          processed: false,
          processingErrors: {
            message: processingErr.message,
            stack: processingErr.stack,
            timestamp: new Date()
          }
        }, { transaction });
      }
      
      // Commit the transaction
      await transaction.commit();
      
      // Log success or processing error
      if (processingError) {
        logger.warn(`Stripe event ${event.id} stored but had processing errors`);
      } else {
        logger.info(`Stripe event ${event.id} processed successfully`);
      }
      
      // Return a 200 success response to Stripe (even if processing had errors)
      // This prevents Stripe from retrying - we've stored the event and can process it later
      res.status(200).json({ received: true });
      
    } catch (err) {
      // Roll back the transaction if any database operations failed
      await transaction.rollback();
      throw err; // Let the outer catch handler deal with it
    }
  } catch (err) {
    logger.error(`Stripe webhook error: ${err.message}`, { 
      error: err,
      stack: err.stack,
      stripeSignature: sig ? 'present' : 'missing'
    });
    
    // Return a 400 to Stripe indicating the webhook failed
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
});

// Helper functions to process specific event types
async function handlePaymentIntentSucceeded(event, transaction) {
  const paymentIntent = event.data.object;
  logger.info(`Processing PaymentIntent succeeded: ${paymentIntent.id}`, {
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    customerId: paymentIntent.customer
  });
  
  // Add your business logic here
  // For example:
  // - Update order status
  // - Provision access to content
  // - Record payment in your system
  // - Send confirmation email
  
  // If you need to access other models, make sure to include the transaction
  // Example: await Order.update({ status: 'paid' }, { where: { paymentIntentId: paymentIntent.id }, transaction });
}

async function handlePaymentIntentFailed(event, transaction) {
  const paymentIntent = event.data.object;
  logger.info(`Processing PaymentIntent failed: ${paymentIntent.id}`, {
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    customerId: paymentIntent.customer,
    lastError: paymentIntent.last_payment_error
  });
  
  // Add your business logic for failed payments
}

async function handleInvoicePaid(event, transaction) {
  const invoice = event.data.object;
  logger.info(`Processing Invoice paid: ${invoice.id}`, {
    amount: invoice.amount_paid,
    currency: invoice.currency,
    customerId: invoice.customer,
    subscriptionId: invoice.subscription
  });
  
  // Add your business logic for successful invoice payments
}

async function handleInvoicePaymentFailed(event, transaction) {
  const invoice = event.data.object;
  logger.info(`Processing Invoice payment failed: ${invoice.id}`, {
    amount: invoice.amount_due,
    currency: invoice.currency,
    customerId: invoice.customer,
    subscriptionId: invoice.subscription
  });
  
  // Add your business logic for failed invoice payments
}

async function handleSubscriptionCreated(event, transaction) {
  const subscription = event.data.object;
  logger.info(`Processing Subscription created: ${subscription.id}`, {
    customerId: subscription.customer,
    status: subscription.status,
    planId: subscription.plan?.id
  });
  
  // Add your business logic for new subscriptions
}

async function handleSubscriptionUpdated(event, transaction) {
  const subscription = event.data.object;
  logger.info(`Processing Subscription updated: ${subscription.id}`, {
    customerId: subscription.customer,
    status: subscription.status,
    planId: subscription.plan?.id
  });
  
  // Add your business logic for subscription updates
}

async function handleSubscriptionDeleted(event, transaction) {
  const subscription = event.data.object;
  logger.info(`Processing Subscription deleted: ${subscription.id}`, {
    customerId: subscription.customer,
    status: subscription.status,
    canceledAt: subscription.canceled_at 
      ? new Date(subscription.canceled_at * 1000) 
      : null
  });
  
  // Add your business logic for subscription cancellations
}

/**
 * Reprocess previously failed Stripe events
 * @route POST /api/integrations/stripe/reprocess
 */
const reprocessFailedEvents = asyncHandler(async (req, res) => {
  // Find all unprocessed events, oldest first
  const unprocessedEvents = await StripeEvent.findAll({
    where: { processed: false },
    order: [['stripeEventCreated', 'ASC']],
    limit: 50 // Process in batches
  });
  
  if (unprocessedEvents.length === 0) {
    return res.json({
      success: true,
      message: 'No failed events to reprocess',
      count: 0
    });
  }
  
  // Process each event
  const results = [];
  
  for (const event of unprocessedEvents) {
    // Start a transaction for each event
    const transaction = await sequelize.transaction();
    
    try {
      // Parse stored event data
      const stripeEvent = event.data;
      
      // Process based on event type
      switch (event.stripeEventType) {
        case 'payment_intent.succeeded':
          await handlePaymentIntentSucceeded(stripeEvent, transaction);
          break;
        case 'payment_intent.payment_failed':
          await handlePaymentIntentFailed(stripeEvent, transaction);
          break;
        // Add other event types as needed
        default:
          logger.info(`Skipping unhandled event type: ${event.stripeEventType}`);
      }
      
      // Mark as processed
      await event.update({
        processed: true,
        processedAt: new Date(),
        processingErrors: null
      }, { transaction });
      
      // Commit the transaction
      await transaction.commit();
      
      results.push({
        id: event.id,
        stripeEventId: event.stripeEventId,
        success: true
      });
      
    } catch (error) {
      // Roll back changes
      await transaction.rollback();
      
      // Update with new error
      await event.update({
        processingErrors: {
          message: error.message,
          stack: error.stack,
          timestamp: new Date()
        }
      });
      
      results.push({
        id: event.id,
        stripeEventId: event.stripeEventId,
        success: false,
        error: error.message
      });
      
      logger.error(`Error reprocessing Stripe event ${event.stripeEventId}:`, {
        error: error.message,
        eventId: event.id
      });
    }
  }
  
  // Return results
  res.json({
    success: true,
    message: `Processed ${results.length} events`,
    successCount: results.filter(r => r.success).length,
    failureCount: results.filter(r => !r.success).length,
    results
  });
});

/**
 * Get Stripe event stats
 * @route GET /api/integrations/stripe/stats
 */
const getStripeEventStats = asyncHandler(async (req, res) => {
  // Get basic stats about Stripe events using Sequelize's proper aggregation
  const stats = await StripeEvent.findAll({
    attributes: [
      'stripeEventType',
      [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN processed = true THEN 1 ELSE 0 END')), 'processed_count'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN processed = false THEN 1 ELSE 0 END')), 'unprocessed_count'],
      [sequelize.fn('MIN', sequelize.col('stripeEventCreated')), 'oldest_event'],
      [sequelize.fn('MAX', sequelize.col('stripeEventCreated')), 'newest_event']
    ],
    group: ['stripeEventType'],
    order: [[sequelize.literal('total'), 'DESC']]
  });
  
  // Get counts of unprocessed events
  const unprocessedCount = await StripeEvent.count({
    where: { processed: false }
  });
  
  // Get total events
  const totalCount = await StripeEvent.count();
  
  res.json({
    success: true,
    totalEvents: totalCount,
    unprocessedEvents: unprocessedCount,
    processingRate: totalCount > 0 ? ((totalCount - unprocessedCount) / totalCount) * 100 : 100,
    eventTypeStats: stats
  });
});

module.exports = {
  handleStripeWebhook,
  reprocessFailedEvents,
  getStripeEventStats
};