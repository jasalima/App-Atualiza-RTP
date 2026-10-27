-- Line "Projeto/convênio" of the FAPTO forms: agreement code, quoted title and number.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS agreement text NOT NULL DEFAULT '';
UPDATE projects SET agreement = '7886-6 “Projeto Plano de Desenvolvimento Sustentável do Polo de Agricultura Irrigada do Sudoeste do Tocantins” - CONVÊNIO Nº 29/2026'
  WHERE agreement = '' AND title ILIKE '%Polo de Agricultura Irrigada do Sudoeste do Tocantins%';
