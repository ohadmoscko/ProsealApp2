-- Migration 014: Add phone field to clients
-- ⚠️ Run in Supabase SQL Editor

ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
