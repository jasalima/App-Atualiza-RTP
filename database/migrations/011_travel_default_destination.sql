-- Field trips go to Lagoa da Confusão/TO unless the member states another destination.
ALTER TABLE travel_reports ALTER COLUMN destination SET DEFAULT 'Lagoa da Confusão/TO';
UPDATE travel_reports SET destination = 'Lagoa da Confusão/TO' WHERE trim(destination) = '';
