-- New enabled modules: an own WhatsApp connection, and "sender of the atas" (one per project:
-- the number that sends the atas to the participants).
ALTER TABLE user_modules DROP CONSTRAINT IF EXISTS user_modules_module_check;
ALTER TABLE user_modules ADD CONSTRAINT user_modules_module_check CHECK (module IN ('minutes','whatsapp','minutes_sender'));
CREATE UNIQUE INDEX IF NOT EXISTS user_modules_one_minutes_sender ON user_modules(project_id) WHERE module = 'minutes_sender';
