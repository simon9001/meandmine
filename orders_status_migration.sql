-- Extend order_status enum with the values the application uses.
-- PostgreSQL does not allow removing enum values, so we ADD the missing ones.
-- Run this once in your Supabase SQL editor.

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'awaiting_dispatch';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'dispatched';

-- payment_status: code uses 'paid' but the DB only has 'successful'
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'paid';
