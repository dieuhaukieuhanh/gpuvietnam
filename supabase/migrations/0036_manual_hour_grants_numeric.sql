-- Allow fractional gift-hour settlement (gift → hourly → combo priority).
-- Run in Supabase SQL Editor if not yet applied.
ALTER TABLE public.manual_hour_grants
  ALTER COLUMN hours_granted TYPE numeric USING hours_granted::numeric,
  ALTER COLUMN hours_used TYPE numeric USING hours_used::numeric;
