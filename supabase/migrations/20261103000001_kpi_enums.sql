-- Phase 9: quarterly and half-yearly periods (used by KPI evidence).
-- On its own: a new enum value cannot be used in the transaction that adds it.
alter type public.recurrence_kind add value if not exists 'quarterly';
alter type public.recurrence_kind add value if not exists 'half_yearly';
