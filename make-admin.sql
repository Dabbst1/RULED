-- Run in Supabase SQL Editor AFTER you create your login in Authentication > Users.
-- Gives your account permanent, active access (no payment needed).
insert into public.members (user_id, status, current_period_end, updated_at)
select id, 'active', null, now() from auth.users
where email = 'taylordavid0911@gmail.com'
on conflict (user_id) do update set status = 'active', current_period_end = null, updated_at = now();

select user_id, status from public.members;
