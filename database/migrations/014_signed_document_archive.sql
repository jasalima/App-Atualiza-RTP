-- The signed PDF archived in the project's documents once every signature is collected.
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS archived_document_id uuid REFERENCES documents(id);
