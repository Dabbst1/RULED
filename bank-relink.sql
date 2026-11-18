-- Monerem: reconnecting bank accounts (run once in Supabase > SQL Editor)
alter table public.bank_accounts add column if not exists status_action text default '';
alter table public.bank_transactions add column if not exists dup_of text;
