-- CPF in the member record (digits only; blank when not informed). The CPF that signs is still
-- the one confirmed by the administration in "Editar acesso" (signer_identities).
ALTER TABLE scholars ADD COLUMN IF NOT EXISTS cpf text NOT NULL DEFAULT '';
ALTER TABLE scholars DROP CONSTRAINT IF EXISTS scholars_cpf_digits;
ALTER TABLE scholars ADD CONSTRAINT scholars_cpf_digits CHECK (cpf = '' OR cpf ~ '^[0-9]{11}$');
