-- One-time review reward. Run THIS file alone in the SQL Editor.
-- Do not paste schema.sql again — that file is too long and often
-- stops before this block, which is why Studio says the function
-- is missing.

alter table public.profiles add column if not exists review_proplus_until timestamptz;
alter table public.profiles add column if not exists review_claimed_at timestamptz;

create table if not exists public.review_rewards (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  quote text not null,
  created_at timestamptz not null default now()
);
alter table public.review_rewards enable row level security;

drop policy if exists "own review reward" on public.review_rewards;
create policy "own review reward" on public.review_rewards
  for select using (auth.uid() = owner_id);

drop function if exists public.claim_review_reward(text, text);

create function public.claim_review_reward(p_name text, p_quote text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_quote text := left(btrim(regexp_replace(coalesce(p_quote, ''), '\s+', ' ', 'g')), 800);
  v_prof public.profiles%rowtype;
  v_until timestamptz;
  v_paid boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('outcome', 'not-signed-in');
  end if;

  perform pg_advisory_xact_lock(hashtext('pallettai.review:' || auth.uid()::text)::bigint);

  if length(v_name) < 2 then
    return jsonb_build_object('outcome', 'bad-input', 'reason', 'name');
  end if;
  if length(v_quote) < 40 then
    return jsonb_build_object('outcome', 'bad-input', 'reason', 'quote');
  end if;

  select * into v_prof from public.profiles where id = auth.uid();
  if v_prof.id is null then
    return jsonb_build_object('outcome', 'no-account');
  end if;

  if v_prof.review_claimed_at is not null
     or exists (select 1 from public.review_rewards where owner_id = auth.uid()) then
    return jsonb_build_object('outcome', 'already-claimed');
  end if;

  insert into public.review_rewards (owner_id, display_name, quote)
  values (auth.uid(), v_name, v_quote);

  v_paid := v_prof.entitlement_source in ('stripe', 'license')
    and v_prof.plan in ('pro', 'proplus')
    and (v_prof.plan_expires_at is null or v_prof.plan_expires_at > now());

  update public.profiles set review_claimed_at = now()
  where id = auth.uid();

  if v_paid then
    return jsonb_build_object('outcome', 'already-paid', 'days', 0);
  end if;

  v_until := now() + interval '3 days';
  update public.profiles set review_proplus_until = v_until
  where id = auth.uid();

  return jsonb_build_object('outcome', 'granted', 'days', 3, 'until', v_until);
end $$;

revoke all on function public.claim_review_reward(text, text) from public, anon;
grant execute on function public.claim_review_reward(text, text) to authenticated;

revoke all on table public.review_rewards from anon, public;
grant select on table public.review_rewards to authenticated;

notify pgrst, 'reload schema';
