-- Trips leave from Palmas/TO unless the member states another origin.
ALTER TABLE travel_reports ALTER COLUMN origin SET DEFAULT 'Palmas/TO';
UPDATE travel_reports SET origin = 'Palmas/TO' WHERE trim(origin) = '';
