-- Routes Table Template
-- This template creates a table for storing event routing configurations

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  event_types JSONB NOT NULL DEFAULT '["*"]',
  transformation_id UUID NOT NULL REFERENCES transformations(id),
  destination_id UUID NOT NULL REFERENCES destinations(id),
  condition JSONB,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_used TIMESTAMP WITH TIME ZONE,
  use_count INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE UNIQUE INDEX IF NOT EXISTS routes_name_idx ON routes(name);
CREATE INDEX IF NOT EXISTS routes_transformation_idx ON routes(transformation_id);
CREATE INDEX IF NOT EXISTS routes_destination_idx ON routes(destination_id);
CREATE INDEX IF NOT EXISTS routes_enabled_idx ON routes(enabled);
CREATE INDEX IF NOT EXISTS routes_priority_idx ON routes(priority);
CREATE INDEX IF NOT EXISTS routes_event_types_idx ON routes USING GIN(event_types);

-- Add a comment to the table
COMMENT ON TABLE routes IS 'Stores route configurations connecting events to transformations and destinations';