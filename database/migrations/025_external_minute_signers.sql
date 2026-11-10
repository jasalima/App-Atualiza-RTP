-- External members (no account) sign the ata by the public link: the draft must accept them
-- marked to sign. The old rule demanded an account (auth_user_id) and made saving fail with 500.
-- A signer is now: present/guest AND (an account, a member record, or a guest with CPF and phone).
-- When the ata is sent, each one without an account gets an "external:<uuid>" signer id.
ALTER TABLE meeting_minute_participants DROP CONSTRAINT IF EXISTS meeting_minute_participants_check;
ALTER TABLE meeting_minute_participants ADD CONSTRAINT meeting_minute_participants_signer CHECK (
  NOT signs OR (attendance IN ('present','guest') AND (auth_user_id IS NOT NULL OR scholar_id IS NOT NULL OR (cpf <> '' AND phone <> '')))
);
