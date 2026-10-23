-- Months in which the individual cronograma foresees each activity ('YYYY-MM').
-- starts_on/ends_on keep the overall span; this keeps gaps between marked columns.
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS scheduled_months text[] NOT NULL DEFAULT '{}';
ALTER TABLE plan_items DROP CONSTRAINT IF EXISTS plan_items_scheduled_months_format;
ALTER TABLE plan_items ADD CONSTRAINT plan_items_scheduled_months_format
  CHECK (array_to_string(scheduled_months, ',') ~ '^([0-9]{4}-(0[1-9]|1[0-2])(,|$))*$');
