const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/connection');

/**
 * Stripe Event model for storing webhook events
 * Creates a dedicated table for Stripe events
 */
const StripeEvent = sequelize.define('StripeEvent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  stripeEventId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Stripe\'s unique event ID'
  },
  stripeEventType: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Type of Stripe event (e.g., "payment_intent.succeeded")'
  },
  stripeEventCreated: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'When the event occurred in Stripe'
  },
  stripeAccount: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Connected account ID if using Stripe Connect'
  },
  stripeApiVersion: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Stripe API version used for this event'
  },
  objectId: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'ID of the object this event is about (e.g., payment_intent ID)'
  },
  objectType: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Type of object this event is about (e.g., "payment_intent")'
  },
  data: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'Full event payload from Stripe'
  },
  processed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether this event has been fully processed'
  },
  processingErrors: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
    comment: 'Any errors encountered during processing'
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When this event was successfully processed'
  }
}, {
  tableName: 'stripe_events',
  timestamps: true,
  indexes: [
    {
      name: 'stripe_events_stripe_event_id_idx',
      unique: true,
      fields: ['stripeEventId']
    },
    {
      name: 'stripe_events_stripe_event_type_idx',
      fields: ['stripeEventType']
    },
    {
      name: 'stripe_events_stripe_event_created_idx',
      fields: ['stripeEventCreated']
    },
    {
      name: 'stripe_events_object_id_idx',
      fields: ['objectId']
    },
    {
      name: 'stripe_events_processed_idx',
      fields: ['processed']
    },
    {
      name: 'stripe_events_object_type_idx',
      fields: ['objectType']
    }
  ]
});

module.exports = StripeEvent;