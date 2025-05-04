-- Stripe Events Table Template
-- This template creates a dedicated table for storing Stripe webhook events

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_event_type VARCHAR(255) NOT NULL,
  stripe_event_created TIMESTAMP WITH TIME ZONE NOT NULL,
  stripe_account VARCHAR(255),
  stripe_api_version VARCHAR(50),
  object_id VARCHAR(255) NOT NULL,
  object_type VARCHAR(100) NOT NULL,
  data JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_errors JSONB,
  processed_at TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS stripe_events_stripe_event_type_idx ON stripe_events(stripe_event_type);
CREATE INDEX IF NOT EXISTS stripe_events_stripe_event_created_idx ON stripe_events(stripe_event_created);
CREATE INDEX IF NOT EXISTS stripe_events_object_id_idx ON stripe_events(object_id);
CREATE INDEX IF NOT EXISTS stripe_events_object_type_idx ON stripe_events(object_type);
CREATE INDEX IF NOT EXISTS stripe_events_processed_idx ON stripe_events(processed);

-- Add GIN index for efficient querying of JSON data
CREATE INDEX IF NOT EXISTS stripe_events_data_idx ON stripe_events USING GIN(data);

-- Add a comment to the table
COMMENT ON TABLE stripe_events IS 'Stores Stripe webhook events for processing and auditing';