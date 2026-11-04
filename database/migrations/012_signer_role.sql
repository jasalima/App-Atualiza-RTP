-- Signature-only accounts: they sign travel accountability reports and RTPs
-- and reach nothing else. Added alone: a new enum value is usable only after commit.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'signer';
