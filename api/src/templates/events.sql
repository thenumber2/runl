-- Events Table Template
-- This template creates an events table for tracking system activities and user actions

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name VARCHAR(100) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  properties JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS events_event_name_idx ON events(event_name);
CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events(timestamp);

-- Add GIN index for efficient querying of JSON properties
CREATE INDEX IF NOT EXISTS events_properties_idx ON events USING GIN(properties);

-- Create specific index for common property queries (like userId)
CREATE INDEX IF NOT EXISTS events_user_id_idx ON events(
  (properties->>'userId')
);

-- Create index for composite searches (event type + timestamp)
CREATE INDEX IF NOT EXISTS events_compound_idx ON events(event_name, timestamp);

-- Add a comment to the table
COMMENT ON TABLE events IS 'Event tracking table for system activities and user actions';