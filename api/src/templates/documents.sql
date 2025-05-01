-- Documents Table Template
-- This template creates a document storage table with full-text search capabilities

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  content_vector TSVECTOR,
  document_type VARCHAR(50) NOT NULL,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS documents_document_type_idx ON documents(document_type);
CREATE INDEX IF NOT EXISTS documents_title_idx ON documents(title);
CREATE INDEX IF NOT EXISTS documents_tags_idx ON documents USING GIN(tags);
CREATE INDEX IF NOT EXISTS documents_metadata_idx ON documents USING GIN(metadata);

-- Add full-text search index if content_vector is populated
CREATE INDEX IF NOT EXISTS documents_content_search_idx ON documents USING GIN(content_vector);

-- Create a trigger function to automatically update the tsvector column
CREATE OR REPLACE FUNCTION documents_update_content_vector()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content IS NOT NULL THEN
    NEW.content_vector = to_tsvector('english', NEW.title || ' ' || NEW.content);
  ELSE
    NEW.content_vector = to_tsvector('english', NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'documents_content_vector_trigger'
  ) THEN
    CREATE TRIGGER documents_content_vector_trigger
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_update_content_vector();
  END IF;
END$$;

-- Add a comment to the table
COMMENT ON TABLE documents IS 'Document storage with full-text search capabilities';