-- Monerem bill reminder emails: run this ONCE in Supabase > SQL Editor, after the bill-reminders function is deployed.
-- Replace PASTE_YOUR_REMINDER_SECRET (2 places) with the same value you saved as the REMINDER_SECRET secret.

-- 1) Tools the schedule needs (safe to run more than once)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Every hour, on the hour, check for reminders. Each member gets theirs at 8 AM in their own time zone.
select cron.schedule('monerem-bill-reminders', '0 * * * *', $$
  select net.http_post(
    url     := 'https://qytsgfjyiybxucxtbcne.supabase.co/functions/v1/bill-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_YOUR_REMINDER_SECRET'),
    body    := '{}'::jsonb
  );
$$);

-- 3) OPTIONAL test: send yourself a reminder right now (needs a bill due within its "Remind me" days).
-- select net.http_post(
--   url     := 'https://qytsgfjyiybxucxtbcne.supabase.co/functions/v1/bill-reminders',
--   headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', 'PASTE_YOUR_REMINDER_SECRET'),
--   body    := jsonb_build_object('testUser', (select id from auth.users where email = 'YOUR_LOGIN_EMAIL'))
-- );

-- To stop the emails later:  select cron.unschedule('monerem-bill-reminders');
