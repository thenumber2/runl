-- Transformations Table Template
-- This template creates a table for storing event data transformation configurations

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS transformations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(50) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE UNIQUE INDEX IF NOT EXISTS transformations_name_idx ON transformations(name);
CREATE INDEX IF NOT EXISTS transformations_type_idx ON transformations(type);
CREATE INDEX IF NOT EXISTS transformations_enabled_idx ON transformations(enabled);

-- Add constraint for valid transformation types
DO $$
BEGIN
  -- Check if the constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'transformations_type_check'
  ) THEN
    -- Add the constraint if it doesn't exist
    ALTER TABLE transformations
    ADD CONSTRAINT transformations_type_check 
    CHECK (type IN ('mapping', 'template', 'script', 'jsonpath', 'slack', 'mixpanel', 'identity'));
  END IF;
END$$;

-- Add a comment to the table
COMMENT ON TABLE transformations IS 'Stores transformation configurations for event data formatting';