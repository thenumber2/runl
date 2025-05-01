-- Metrics Table Template
-- This template creates a time-series metrics table optimized for analytics

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  value NUMERIC(20, 6) NOT NULL,
  tags JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS metrics_metric_name_idx ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS metrics_timestamp_idx ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS metrics_tags_idx ON metrics USING GIN(tags);

-- Create a hypertable if TimescaleDB extension is available
DO $$
BEGIN
  -- Check if TimescaleDB extension is available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
  ) THEN
    -- Convert to hypertable if it's not already
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertables 
      WHERE hypertable_name = 'metrics'
    ) THEN
      PERFORM create_hypertable('metrics', 'timestamp');
    END IF;
  END IF;
END$$;

-- Add a comment to the table
COMMENT ON TABLE metrics IS 'Time-series metrics data for monitoring and analytics';