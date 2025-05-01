-- Data Table Template
-- This template creates the default data table with proper indexes and constraints

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  data JSONB NOT NULL,
  source VARCHAR(255),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS data_timestamp_idx ON data(timestamp);
CREATE INDEX IF NOT EXISTS data_status_idx ON data(status);
CREATE INDEX IF NOT EXISTS data_jsonb_idx ON data USING GIN(data);
CREATE INDEX IF NOT EXISTS data_metadata_idx ON data USING GIN(metadata);

-- Add ENUM constraint for status
DO $$
BEGIN
  -- Check if the constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'data_status_check'
  ) THEN
    -- Add the constraint if it doesn't exist
    ALTER TABLE data
    ADD CONSTRAINT data_status_check 
    CHECK (status IN ('pending', 'processed', 'error'));
  END IF;
END$$;

-- Add a comment to the table
COMMENT ON TABLE data IS 'Stores flexible data records with JSON data structure';