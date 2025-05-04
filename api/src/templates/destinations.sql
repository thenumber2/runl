-- Destinations Table Template
-- This template creates a table for storing webhook forwarding destinations

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(50) NOT NULL,
  url VARCHAR(2000) NOT NULL,
  event_types JSONB NOT NULL DEFAULT '["*"]',
  config JSONB NOT NULL DEFAULT '{}',
  secret_key VARCHAR(255),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent TIMESTAMP WITH TIME ZONE,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE UNIQUE INDEX IF NOT EXISTS destinations_name_idx ON destinations(name);
CREATE INDEX IF NOT EXISTS destinations_type_idx ON destinations(type);
CREATE INDEX IF NOT EXISTS destinations_enabled_idx ON destinations(enabled);
CREATE INDEX IF NOT EXISTS destinations_event_types_idx ON destinations USING GIN(event_types);

-- Add constraint for valid destination types
DO $$
BEGIN
  -- Check if the constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'destinations_type_check'
  ) THEN
    -- Add the constraint if it doesn't exist
    ALTER TABLE destinations
    ADD CONSTRAINT destinations_type_check 
    CHECK (type IN ('slack', 'mixpanel', 'webhook', 'custom'));
  END IF;
END$$;

-- Add a comment to the table
COMMENT ON TABLE destinations IS 'Stores webhook forwarding destinations for the event stream';