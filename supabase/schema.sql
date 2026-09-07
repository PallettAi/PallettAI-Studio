-- ============================================================
-- PallettAI Studio — cloud registry (Phase 2b)
-- Accounts + one stable referral code per account + stamped
-- redemption trace log, enforced server-side.
--
-- HOW TO USE: open your Supabase project → SQL Editor →
-- New query → paste this ENTIRE file → Run.
-- If "Leave a review" says the function is missing, do not
-- re-run this file. Run supabase/review-reward.sql alone.
-- ============================================================

-- ---------- 1. Profiles: one row per auth user ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  trial_expires_at timestamptz,          -- earned Pro trial (referral rewards)
  created_at timestamptz not null default now()
);

-- ---------- 2. Referral codes: EXACTLY one per user ----------
-- owner_id is UNIQUE — an account can never mint a second code.
create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  code text not null unique,             -- e.g. REF-A7K2QX
  created_at timestamptz not null default now()
);

-- ---------- 3. Trace log: every attempt, stamped ----------
create table if not exists public.redemptions (
  id bigint generated always as identity primary key,
  code text not null,
  code_owner uuid references auth.users (id) on delete set null,
  redeemer uuid not null references auth.users (id) on delete cascade,
  outcome text not null,
  -- verified | already-used | self-redeemed | not-found
  granted_redeemer_days int not null default 0,
  granted_owner_days int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 4. Row-level security: users see only their own data ----------
alter table public.profiles enable row level security;
alter table public.referral_codes enable row level security;
alter table public.redemptions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own code" on public.referral_codes;
create policy "own code" on public.referral_codes
  for select using (auth.uid() = owner_id);

-- Code owners see redemptions of their code; redeemers see their own attempts
drop policy if exists "own redemptions" on public.redemptions;
create policy "own redemptions" on public.redemptions
  for select using (auth.uid() = redeemer or auth.uid() = code_owner);

-- ---------- 5. Code generator (human-friendly alphabet) ----------
create or replace function public.gen_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text := '';
  i int;
begin
  for i in 1..6 loop
    c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return 'REF-' || c;
end $$;

-- ---------- 6. Signup trigger: profile + stable code, atomically ----------
-- The code insert retries on unique_violation: two concurrent signups can draw
-- the same code, and the retry makes sure one of them never loses the signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;

  loop
    c := public.gen_code();
    begin
      insert into public.referral_codes (owner_id, code) values (new.id, c);
      exit;
    exception when unique_violation then
      -- code collided with a concurrent signup — draw another one
      null;
    end;
  end loop;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 7. Redemption RPC: the single verified path ----------
-- Grants redeemer +30 Pro days, referrer +7 Pro days (stacking).
-- Every call writes a stamped trace record — nothing silently succeeds.
-- Hardening:
--   * advisory lock serializes same-account calls, so a double-click or
--     concurrent tab can never double-grant
--   * an owner can earn at most 60 reward days total from referrals, which
--     blunts farming loops (N fake accounts redeeming one person's code)
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code public.referral_codes%rowtype;
  v_until timestamptz;
  v_clean text := upper(trim(p_code));
  v_owner_days int;
  v_max_owner_days constant int := 60;
begin
  -- serialize this redeemer's calls so concurrent requests can't double-grant
  perform pg_advisory_xact_lock(hashtext('pallettai.redeem:' || auth.uid()::text)::bigint);

  select * into v_code from public.referral_codes where code = v_clean;

  -- code doesn't exist → record the attempt, grant nothing
  if v_code is null then
    insert into public.redemptions (code, redeemer, outcome)
    values (v_clean, auth.uid(), 'not-found');
    return jsonb_build_object('outcome', 'not-found', 'grantedDays', 0);
  end if;

  -- you can't redeem your own code
  if v_code.owner_id = auth.uid() then
    insert into public.redemptions (code, code_owner, redeemer, outcome)
    values (v_code.code, v_code.owner_id, auth.uid(), 'self-redeemed');
    return jsonb_build_object('outcome', 'self-redeemed', 'grantedDays', 0);
  end if;

  -- one redemption per account per code (verified OR already-used both block)
  if exists (
    select 1 from public.redemptions r
    where r.code = v_code.code and r.redeemer = auth.uid()
      and r.outcome in ('verified', 'already-used')
  ) then
    insert into public.redemptions (code, code_owner, redeemer, outcome)
    values (v_code.code, v_code.owner_id, auth.uid(), 'already-used');
    return jsonb_build_object('outcome', 'already-used', 'grantedDays', 0);
  end if;

  -- grant the redeemer +30 days (stacked on any existing trial)
  update public.profiles set trial_expires_at =
    greatest(coalesce(trial_expires_at, now()), now()) + interval '30 days'
  where id = auth.uid()
  returning trial_expires_at into v_until;

  -- anti-farming: cap total reward one owner can earn from referrals
  select coalesce(sum(granted_owner_days), 0)::int into v_owner_days
  from public.redemptions where code_owner = v_code.owner_id;

  if v_owner_days >= v_max_owner_days then
    -- redeemer still verified (+30); owner reward paused at the cap
    insert into public.redemptions (code, code_owner, redeemer, outcome, granted_redeemer_days, granted_owner_days)
    values (v_code.code, v_code.owner_id, auth.uid(), 'verified', 30, 0);
    return jsonb_build_object(
      'outcome', 'verified',
      'grantedDays', 30,
      'trialExpiresAt', v_until,
      'ownerCapped', true
    );
  end if;

  -- grant the referrer +7 days for this successful redemption
  update public.profiles set trial_expires_at =
    greatest(coalesce(trial_expires_at, now()), now()) + interval '7 days'
  where id = v_code.owner_id;

  insert into public.redemptions (code, code_owner, redeemer, outcome, granted_redeemer_days, granted_owner_days)
  values (v_code.code, v_code.owner_id, auth.uid(), 'verified', 30, 7);

  return jsonb_build_object(
    'outcome', 'verified',
    'grantedDays', 30,
    'trialExpiresAt', v_until
  );
end $$;

-- ---------- 8. Permissions ----------
grant execute on function public.redeem_code(text) to authenticated;
grant select on public.profiles to authenticated;
grant select on public.referral_codes to authenticated;
grant select on public.redemptions to authenticated;
-- ============================================================
-- PART 2 — Registry license keys (account-bound PAL-* keys)
-- Re-run the whole file anytime: every statement is idempotent.
-- ============================================================

-- ---------- 9. Licenses: keys minted by PallettAI ----------
-- Mint keys by INSERTing rows here (or via a secure Edge Function
-- when the sales page goes live). No demo keys are shipped: a public
-- demo key in the repo would be free Pro for anyone who reads it.
-- (A purge below removes any demo rows seeded by older releases.)
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- e.g. PAL-PRO-XXXX-XXXX
  plan text not null,
  owner_id uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  expires_at timestamptz,               -- null = lifetime (demo)
  revoked boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);
-- `create table if not exists` does not update an existing table, so migrate
-- the retired Agency value before replacing its old check constraint. Existing
-- PAL-AGENCY keys remain valid as legacy keys, but their entitlement is Pro+.
alter table public.licenses drop constraint if exists licenses_plan_check;
do $$
declare
  c record;
begin
  -- PostgreSQL can generate a different name for an unnamed inline CHECK;
  -- remove any old plan constraint whose definition still contains Agency.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.licenses'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%agency%'
  loop
    execute format('alter table public.licenses drop constraint %I', c.conname);
  end loop;
end $$;
update public.licenses set plan = 'proplus' where plan = 'agency';
alter table public.licenses add constraint licenses_plan_check check (plan in ('pro','proplus'));
alter table public.licenses enable row level security;
drop policy if exists "owner sees own license" on public.licenses;
create policy "owner sees own license" on public.licenses
  for select using (auth.uid() = owner_id);

-- Account-bound entitlement state (synced to every device the user signs into)
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists plan_expires_at timestamptz;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists entitlement_source text;
alter table public.profiles drop constraint if exists profiles_plan_check;
update public.profiles set plan = 'proplus' where plan = 'agency';
alter table public.profiles add constraint profiles_plan_check check (plan in ('free','pro','proplus'));

-- Purge any demo/legacy-demo rows seeded by older releases of this file, so a
-- repo-readable demo key can never be activated against the live registry.
delete from public.licenses where note in ('demo', 'legacy-demo');

-- ---------- 10. License activation RPC ----------
-- Binds the key to the calling account (one account per key), stamps the
-- activation, writes the plan + expiry onto the account, and returns them.
create or replace function public.activate_license(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lic public.licenses%rowtype;
  v_code text := upper(trim(p_code));
begin
  -- serialize activations of this key: two accounts racing to bind the same
  -- free key can never both succeed (one gets 'in-use')
  perform pg_advisory_xact_lock(hashtext('pallettai.activate:' || v_code)::bigint);

  select * into v_lic from public.licenses where code = v_code;

  if v_lic is null then
    return jsonb_build_object('outcome', 'not-found');
  end if;
  if v_lic.revoked then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if v_lic.owner_id is not null and v_lic.owner_id <> auth.uid() then
    return jsonb_build_object('outcome', 'in-use');
  end if;
  if v_lic.expires_at is not null and v_lic.expires_at < now() then
    return jsonb_build_object('outcome', 'expired');
  end if;

  update public.licenses set owner_id = auth.uid(), activated_at = coalesce(activated_at, now())
  where id = v_lic.id;

  update public.profiles set
    plan = v_lic.plan,
    plan_expires_at = v_lic.expires_at,
    entitlement_source = 'license'
  where id = auth.uid();

  return jsonb_build_object('outcome', 'verified', 'plan', v_lic.plan, 'expiresAt', v_lic.expires_at);
end $$;

grant execute on function public.activate_license(text) to authenticated;
grant select on public.licenses to authenticated;

-- ============================================================
-- PART 3 — Daily streak + Day-7 wheel
-- Free bonus AI credits, short Pro-time bursts and streak-freeze
-- shields, granted daily. Everything is server-decided and
-- server-stamped: the UTC day comes from the database clock, one
-- claim per (user, day) is DB-enforced, and each completed week
-- yields exactly ONE wheel spin (server RNG) — so clock tampering,
-- re-rolls, duplicate claims and replayed spins are impossible
-- from the client. Re-run the whole file: all statements are
-- idempotent.
-- ============================================================

-- ---------- 11. user_streaks: 1:1 with auth.users ----------
create table if not exists public.user_streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consecutive_days int not null default 0 check (consecutive_days >= 0),
  best_days int not null default 0 check (best_days >= 0),
  last_claim_date date,
  frozen_date date,                       -- the day a shield covered
  shields int not null default 0 check (shields between 0 and 2),
  bonus_credits int not null default 0 check (bonus_credits >= 0),
  wheel_pending boolean not null default false,  -- one un-spun Day-7 wheel earned
  updated_at timestamptz not null default now()
);
alter table public.user_streaks enable row level security;
drop policy if exists "own streak" on public.user_streaks;
create policy "own streak" on public.user_streaks
  for select using (auth.uid() = user_id);

-- ---------- 12. streak_claims: stamped audit log ----------
-- unique (user_id, claim_date) is the hard anti-duplicate guard:
-- a second claim for the same UTC day can never be inserted.
create table if not exists public.streak_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_date date not null,
  action text not null default 'claim',
  cycle_day int not null check (cycle_day between 1 and 7),
  prize_type text not null check (prize_type in ('credits','wheel')),
  prize_amount int not null default 0,
  shield_used boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, claim_date)
);
alter table public.streak_claims enable row level security;
drop policy if exists "own claims" on public.streak_claims;
create policy "own claims" on public.streak_claims
  for select using (auth.uid() = user_id);

-- ---------- 13. wheel_spins: stamped audit log ----------
create table if not exists public.wheel_spins (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  spin_date date not null,
  prize_type text not null check (prize_type in ('credits','pro_hours','shield')),
  prize_amount int not null default 0,    -- credits or Pro hours (shield = 0)
  created_at timestamptz not null default now()
);
alter table public.wheel_spins enable row level security;
drop policy if exists "own spins" on public.wheel_spins;
create policy "own spins" on public.wheel_spins
  for select using (auth.uid() = user_id);

-- ---------- 14. Shared state payload ----------
-- Every RPC returns the same shape so the client can render the
-- widget straight from any response. Read-only; never mutates.
create or replace function public.streak_payload()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.user_streaks%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_gap int;
  v_claimed boolean;
  v_cycle int;            -- cycle day of the most recent claim (0 if never)
  v_next int;             -- cycle day the NEXT claim would land on
  v_restart boolean;      -- next claim starts a fresh streak
  v_freeze boolean;       -- next claim consumes a shield instead
  v_prize jsonb;
  v_schedule jsonb;
begin
  select * into v_row from public.user_streaks where user_id = auth.uid();
  v_gap := 0;
  if v_row.last_claim_date is not null then
    v_gap := v_today - v_row.last_claim_date;
  end if;
  v_claimed := v_row.last_claim_date = v_today;

  if coalesce(v_row.consecutive_days, 0) = 0 then
    v_cycle := 0; v_next := 1; v_restart := false; v_freeze := false;
  else
    v_cycle := ((v_row.consecutive_days - 1) % 7) + 1;
    v_next := (v_row.consecutive_days % 7) + 1;
    if v_claimed then
      v_restart := false; v_freeze := false;
    elsif v_gap >= 2 then
      -- exactly one whole missed day can be covered by a shield
      v_freeze := (v_gap = 2) and v_row.shields >= 1;
      v_restart := not v_freeze;
    else
      v_restart := false; v_freeze := false;
    end if;
    -- a restarting claim always lands on Day 1 of a fresh cycle
    if v_restart then v_next := 1; end if;
  end if;

  if v_next between 1 and 6 then
    v_prize := jsonb_build_object('type', 'credits', 'amount', v_next + 1);
  else
    v_prize := jsonb_build_object('type', 'wheel');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'day', g,
      'prize', case when g = 7
        then jsonb_build_object('type', 'wheel')
        else jsonb_build_object('type', 'credits', 'amount', g + 1) end
    ) order by g)
  into v_schedule from generate_series(1, 7) g;

  return jsonb_build_object(
    'ok', true,
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'streak', coalesce(v_row.consecutive_days, 0),
    'best', greatest(coalesce(v_row.best_days, 0), coalesce(v_row.consecutive_days, 0)),
    'shields', coalesce(v_row.shields, 0),
    'bonusCredits', coalesce(v_row.bonus_credits, 0),
    'wheelPending', coalesce(v_row.wheel_pending, false),
    'claimedToday', v_claimed,
    'frozenToday', v_row.frozen_date = v_today,
    'cycleDay', v_cycle,
    'nextCycle', v_next,
    'restarting', v_restart,
    'freezeNext', v_freeze,
    'nextPrize', v_prize,
    'schedule', v_schedule
  );
end $$;

-- ---------- 15. get_streak_state: safe to call anytime ----------
create or replace function public.get_streak_state()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.streak_payload();
end $$;

-- ---------- 16. claim_daily_reward ----------
-- One claim per (user, UTC day). Grants the escalating daily prize
-- (Day 1-6 → +2..+7 bonus credits; Day 7 → wheel + 1 shield capped
-- at 2). A single missed day between claims consumes a shield and
-- keeps the streak; any longer gap (or no shield) restarts it.
create or replace function public.claim_daily_reward(p_action text default 'claim')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.user_streaks%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_gap int;
  v_cycle int;
  v_prize_type text;
  v_prize_amount int := 0;
  v_shield_granted boolean := false;
  v_shield_used boolean := false;
  v_payload jsonb;
begin
  -- serialize this user's calls: concurrent claims can never double-grant
  perform pg_advisory_xact_lock(hashtext('pallettai.streak:' || auth.uid()::text)::bigint);

  select * into v_row from public.user_streaks where user_id = auth.uid();
  if not found then
    insert into public.user_streaks (user_id)
    values (auth.uid())
    returning * into v_row;
  end if;

  if v_row.last_claim_date = v_today then
    v_payload := public.streak_payload();
    return v_payload || jsonb_build_object('outcome', 'already-claimed');
  end if;

  -- gap handling: reset / freeze / continue
  v_gap := 0;
  if v_row.last_claim_date is not null then
    v_gap := v_today - v_row.last_claim_date;
  end if;
  if v_row.last_claim_date is not null and v_gap > 1 then
    if v_gap = 2 and v_row.shields >= 1 then
      -- exactly one missed day, one shield held → cover it
      v_shield_used := true;
      v_row.shields := v_row.shields - 1;
      v_row.frozen_date := v_today - 1;
    else
      -- gap too long or no shield → the streak restarts from today
      v_row.consecutive_days := 0;
      v_row.frozen_date := null;
    end if;
  end if;

  v_row.consecutive_days := v_row.consecutive_days + 1;
  v_row.best_days := greatest(v_row.best_days, v_row.consecutive_days);
  v_row.last_claim_date := v_today;
  v_cycle := ((v_row.consecutive_days - 1) % 7) + 1;

  if v_cycle between 1 and 6 then
    v_prize_type := 'credits';
    v_prize_amount := v_cycle + 1;                 -- day 1 → +2 … day 6 → +7
    v_row.bonus_credits := v_row.bonus_credits + v_prize_amount;
  else
    v_prize_type := 'wheel';                       -- Day 7: unlock the wheel
    v_row.wheel_pending := true;
    if v_row.shields < 2 then                      -- weekly shield (cap 2)
      v_row.shields := v_row.shields + 1;
      v_shield_granted := true;
    else                                           -- overflow → +5 credits
      v_row.bonus_credits := v_row.bonus_credits + 5;
    end if;
  end if;

  update public.user_streaks set
    consecutive_days = v_row.consecutive_days,
    best_days = v_row.best_days,
    last_claim_date = v_row.last_claim_date,
    frozen_date = v_row.frozen_date,
    shields = v_row.shields,
    bonus_credits = v_row.bonus_credits,
    wheel_pending = v_row.wheel_pending,
    updated_at = now()
  where user_id = auth.uid();

  insert into public.streak_claims
    (user_id, claim_date, action, cycle_day, prize_type, prize_amount, shield_used)
  values
    (auth.uid(), v_today, coalesce(nullif(trim(p_action), ''), 'claim'),
     v_cycle, v_prize_type, v_prize_amount, v_shield_used);

  v_payload := public.streak_payload();
  return v_payload || jsonb_build_object(
    'outcome', 'claimed',
    'claim', jsonb_build_object(
      'cycleDay', v_cycle,
      'prizeType', v_prize_type,
      'prizeAmount', v_prize_amount,
      'shieldGranted', v_shield_granted,
      'shieldUsed', v_shield_used
    )
  );
end $$;

-- ---------- 17. spin_wheel ----------
-- Allowed exactly once per completed week: requires wheel_pending
-- (set only by a Day-7 claim) and clears it in the same transaction,
-- so a spin can never be replayed. Outcome is picked by the server.
-- 12 equal segments, every one wins:
--   +3 credits ×2 · +5 credits ×2 · +10 credits ×1
--   3h Pro ×2 · 12h Pro ×1 · 1d Pro ×1 · 3d Pro ×1
--   streak shield ×1 (→ +5 credits at cap 2) · 7d Pro jackpot ×1
create or replace function public.spin_wheel()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.user_streaks%rowtype;
  v_today date := (now() at time zone 'utc')::date;
  v_pick int;
  v_type text := 'credits';
  v_amount int := 0;
  v_until timestamptz;
  v_payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('pallettai.streak:' || auth.uid()::text)::bigint);

  select * into v_row from public.user_streaks where user_id = auth.uid();
  if not found then
    v_payload := public.streak_payload();
    return v_payload || jsonb_build_object('outcome', 'not-ready');
  end if;
  if not v_row.wheel_pending then
    v_payload := public.streak_payload();
    return v_payload || jsonb_build_object('outcome', 'not-ready');
  end if;

  v_pick := 1 + floor(random() * 12)::int;
  --               1      2      3     4      5      6      7      8      9       10     11     12
  case v_pick
    when 1  then v_type := 'credits';  v_amount := 3;
    when 2  then v_type := 'credits';  v_amount := 5;
    when 3  then v_type := 'credits';  v_amount := 10;
    when 4  then v_type := 'pro_hours'; v_amount := 3;
    when 5  then v_type := 'pro_hours'; v_amount := 3;
    when 6  then v_type := 'pro_hours'; v_amount := 12;
    when 7  then v_type := 'pro_hours'; v_amount := 24;
    when 8  then v_type := 'pro_hours'; v_amount := 72;
    when 9  then v_type := 'shield';
    when 10 then v_type := 'pro_hours'; v_amount := 168;   -- 7-day jackpot
    when 11 then v_type := 'credits';  v_amount := 5;
    else         v_type := 'credits';  v_amount := 3;
  end case;

  -- resolve the actual prize
  if v_type = 'credits' then
    v_row.bonus_credits := v_row.bonus_credits + v_amount;
  elsif v_type = 'pro_hours' then
    update public.profiles set trial_expires_at =
      greatest(coalesce(trial_expires_at, now()), now()) +
      make_interval(hours => v_amount)
    where id = auth.uid()
    returning trial_expires_at into v_until;
  else
    -- shield segment: grants a shield unless already at the cap of 2
    if v_row.shields < 2 then
      v_row.shields := v_row.shields + 1;
      v_type := 'shield';
      v_amount := 0;
    else
      v_type := 'credits';
      v_amount := 5;
      v_row.bonus_credits := v_row.bonus_credits + 5;
    end if;
  end if;

  v_row.wheel_pending := false;
  update public.user_streaks set
    shields = v_row.shields,
    bonus_credits = v_row.bonus_credits,
    wheel_pending = false,
    updated_at = now()
  where user_id = auth.uid();

  insert into public.wheel_spins (user_id, spin_date, prize_type, prize_amount)
  values (auth.uid(), v_today, v_type, v_amount);

  v_payload := public.streak_payload();
  return v_payload || jsonb_build_object(
    'outcome', 'spun',
    'prize', jsonb_build_object('type', v_type, 'amount', v_amount),
    'trialExpiresAt', v_until
  );
end $$;

-- ---------- 18. Permissions ----------
grant execute on function public.get_streak_state() to authenticated;
grant execute on function public.claim_daily_reward(text) to authenticated;
grant execute on function public.spin_wheel() to authenticated;
grant select on public.user_streaks to authenticated;
grant select on public.streak_claims to authenticated;
grant select on public.wheel_spins to authenticated;

-- ---------- 19. Revoke PUBLIC/anon execution (defense in depth) ----------
-- Postgres grants EXECUTE on new functions to PUBLIC by default, so the
-- `grant … to authenticated` lines above do NOT stop the anon role from
-- entering these SECURITY DEFINER functions. Today auth.uid() is null for
-- anon so nothing persists, but that is luck, not design: signed-out
-- callers must be rejected at the permission gate, never inside the body.
-- (Idempotent — safe to re-run.)
revoke all on function public.redeem_code(text) from public, anon;
revoke all on function public.activate_license(text) from public, anon;
revoke all on function public.streak_payload() from public, anon;
revoke all on function public.get_streak_state() from public, anon;
revoke all on function public.claim_daily_reward(text) from public, anon;
revoke all on function public.spin_wheel() from public, anon;
-- ============================================================
-- PART 4 — Server-authoritative AI credit accounting (Design A)
-- Re-run the whole file anytime: every statement is idempotent.
-- ============================================================

-- ---------- 20. credit_spends: stamped, refundable ledger ----------
-- One row per metered AI generation. `ref` is the client's idempotency
-- key: a retried generation (same ref) can never double-spend. Refunds
-- mark refunded_at within a short window instead of deleting, so the
-- audit trail is never rewritten.
create table if not exists public.credit_spends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  ref text not null,
  amount int not null default 1 check (amount between 1 and 100),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);
alter table public.credit_spends enable row level security;
drop policy if exists "own spends" on public.credit_spends;
create policy "own spends" on public.credit_spends
  for select using (auth.uid() = user_id);

-- ---------- 21. credit_payload: shared state (mirrors streak_payload) ----------
-- Read-only; every credit RPC returns this shape so the client renders the
-- budget straight from any response. used = unrefunded spend rows (audit is
-- the source of truth — no separate counter to drift).
create or replace function public.credit_payload()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof public.profiles%rowtype;
  v_bonus int := 0;
  v_used int := 0;
  v_unlimited boolean;
  v_base constant int := 3;   -- mirrors PLANS free limits.aiCredits
begin
  select * into v_prof from public.profiles where id = auth.uid();
  -- NOTE: SELECT … INTO with no matching row sets the target to NULL (it does
  -- NOT keep its := initialiser), so coalesce AFTER the select, not inside it.
  select bonus_credits into v_bonus
  from public.user_streaks where user_id = auth.uid();
  v_bonus := coalesce(v_bonus, 0);   -- no streak row yet (never claimed) → 0
  select coalesce(sum(amount), 0) into v_used
  from public.credit_spends
  where user_id = auth.uid() and refunded_at is null;

  -- entitlement mirrors the client's isPro(): a live paid plan (bound key,
  -- not expired) OR an active earned Pro trial (referrals / wheel spins).
  v_unlimited :=
    (v_prof.plan in ('pro','proplus')
       and (v_prof.plan_expires_at is null or v_prof.plan_expires_at > now()))
    or (v_prof.trial_expires_at is not null and v_prof.trial_expires_at > now())
    or (v_prof.review_proplus_until is not null and v_prof.review_proplus_until > now());

  return jsonb_build_object(
    'ok', true,
    'plan', coalesce(v_prof.plan, 'free'),
    'unlimited', v_unlimited,
    'baseCredits', v_base,
    'bonusCredits', v_bonus,
    'used', v_used,
    'left', case when v_unlimited then -1 else greatest(0, v_base + v_bonus - v_used) end
  );
end $$;

-- ---------- 22. spend_credit: the only way to consume AI credits ----------
create or replace function public.spend_credit(p_ref text, p_amount int default 1)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref text := left(trim(coalesce(p_ref, '')), 64);
  v_amount int := greatest(1, least(100, coalesce(p_amount, 1)));
  v_state jsonb;
  v_payload jsonb;
begin
  if v_ref = '' then
    return public.credit_payload() || jsonb_build_object('outcome', 'no-ref');
  end if;

  -- serialize this account's spends so racing requests are ordered
  perform pg_advisory_xact_lock(hashtext('pallettai.credits:' || auth.uid()::text)::bigint);

  -- idempotency: a retried generation never double-spends
  if exists (select 1 from public.credit_spends where user_id = auth.uid() and ref = v_ref) then
    return public.credit_payload() || jsonb_build_object('outcome', 'already-spent');
  end if;

  v_state := public.credit_payload();
  if (v_state->>'unlimited')::boolean then
    -- Pro / earned trial: unlimited by entitlement — nothing to meter
    return v_state || jsonb_build_object('outcome', 'unlimited');
  end if;
  if (v_state->>'left')::int < v_amount then
    return v_state || jsonb_build_object('outcome', 'insufficient');
  end if;

  insert into public.credit_spends (user_id, ref, amount)
  values (auth.uid(), v_ref, v_amount);

  v_payload := public.credit_payload();
  return v_payload || jsonb_build_object('outcome', 'spent');
end $$;

-- ---------- 23. refund_credit: undo a spend that produced no output ----------
-- Refundable within 10 minutes of the spend, once. The window is the
-- honest-client contract (a failed generation is refunded immediately);
-- fully server-proof refund semantics need the AI proxy of Design B.
create or replace function public.refund_credit(p_ref text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.credit_spends%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('pallettai.credits:' || auth.uid()::text)::bigint);

  select * into v_row from public.credit_spends
  where user_id = auth.uid() and ref = left(trim(coalesce(p_ref, '')), 64);

  if v_row.id is null then
    return public.credit_payload() || jsonb_build_object('outcome', 'not-found');
  end if;
  if v_row.refunded_at is not null then
    return public.credit_payload() || jsonb_build_object('outcome', 'already-refunded');
  end if;
  if v_row.created_at < now() - interval '10 minutes' then
    return public.credit_payload() || jsonb_build_object('outcome', 'too-late');
  end if;

  update public.credit_spends set refunded_at = now() where id = v_row.id;
  return public.credit_payload() || jsonb_build_object('outcome', 'refunded');
end $$;

-- ---------- 24. get_credit_state: safe to call anytime (sync / reconcile) ----------
create or replace function public.get_credit_state()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.credit_payload();
end $$;

-- ---------- 25. Permissions ----------
grant execute on function public.spend_credit(text, int) to authenticated;
grant execute on function public.refund_credit(text) to authenticated;
grant execute on function public.get_credit_state() to authenticated;
grant select on public.credit_spends to authenticated;
revoke all on function public.credit_payload() from public, anon;
revoke all on function public.spend_credit(text, int) from public, anon;
revoke all on function public.refund_credit(text) from public, anon;
revoke all on function public.get_credit_state() from public, anon;
-- ---------- 26. Hardening: close every remaining anon/public hole ----------
-- Two gaps were confirmed live with the anon key:
--   (1) gen_code()/handle_new_user() were still executable by PUBLIC (Postgres
--       grants EXECUTE on new functions by default) — the anon key could call
--       gen_code() and receive a code back. Harmless alone, but the same
--       default could bite any future helper.
--   (2) Supabase's default grants let the anon role ATTEMPT table reads (RLS
--       returned empty rows, so nothing leaked — but the attempt shouldn't
--       even be possible).
-- Revoke everything anon/public don't need. NOTE: if a future milestone (e.g.
-- the community gallery) needs genuine public reads, re-grant exactly what it
-- needs AND add a matching RLS policy:
--   grant usage on schema public to anon;
--   grant select on public.<table> to anon;
revoke all on function public.gen_code() from public, anon;
revoke all on function public.handle_new_user() from public, anon;
revoke all on table
  public.profiles, public.referral_codes, public.redemptions,
  public.licenses, public.user_streaks, public.streak_claims,
  public.wheel_spins, public.credit_spends
from anon, public;
revoke usage on schema public from anon;

-- ============================================================
-- PART 5 — Stripe entitlements (Payment Links → profiles)
-- Webhook verifies the Stripe signature in Edge Function
-- stripe-webhook, then this RPC writes the plan. Email is
-- ignored: the account is client_reference_id or a stored
-- Stripe customer/subscription id. Re-run is idempotent.
-- ============================================================

alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists entitlement_source text;
alter table public.profiles add column if not exists billing_status text;
alter table public.profiles add column if not exists billing_status_at timestamptz;
alter table public.profiles add column if not exists last_stripe_event_type text;

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists profiles_stripe_subscription_id_uidx
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.stripe_events (
  id text primary key,
  type text not null default '',
  outcome text,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

create or replace function public.apply_stripe_entitlement(
  p_event_id text,
  p_event_type text,
  p_paid boolean,
  p_account_id uuid,
  p_plan text,
  p_customer_id text,
  p_subscription_id text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof public.profiles%rowtype;
  v_plan text;
  v_event text := trim(coalesce(p_event_id, ''));
begin
  if length(v_event) < 4 then
    return jsonb_build_object('outcome', 'bad-event');
  end if;

  insert into public.stripe_events (id, type)
  values (v_event, coalesce(p_event_type, ''))
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if p_account_id is not null then
    select * into v_prof from public.profiles where id = p_account_id;
  end if;
  if v_prof.id is null and coalesce(p_subscription_id, '') <> '' then
    select * into v_prof from public.profiles where stripe_subscription_id = p_subscription_id;
  end if;
  if v_prof.id is null and coalesce(p_customer_id, '') <> '' then
    select * into v_prof from public.profiles where stripe_customer_id = p_customer_id;
  end if;

  if v_prof.id is null then
    update public.stripe_events set outcome = 'no-account' where id = v_event;
    return jsonb_build_object('outcome', 'no-account');
  end if;

  if p_paid then
    v_plan := lower(trim(coalesce(p_plan, '')));
    if v_plan not in ('pro', 'proplus') then
      v_plan := case when v_prof.plan in ('pro', 'proplus') then v_prof.plan else '' end;
    end if;
    if v_plan not in ('pro', 'proplus') then
      update public.stripe_events set outcome = 'bad-plan' where id = v_event;
      return jsonb_build_object('outcome', 'bad-plan');
    end if;

    update public.profiles set
      plan = v_plan,
      plan_expires_at = coalesce(p_expires_at, plan_expires_at),
      stripe_customer_id = coalesce(nullif(p_customer_id, ''), stripe_customer_id),
      stripe_subscription_id = coalesce(nullif(p_subscription_id, ''), stripe_subscription_id),
      entitlement_source = 'stripe',
      billing_status = 'ok',
      billing_status_at = now(),
      last_stripe_event_type = coalesce(p_event_type, '')
    where id = v_prof.id;

    update public.stripe_events set outcome = 'granted' where id = v_event;
    return jsonb_build_object('outcome', 'granted', 'plan', v_plan, 'accountId', v_prof.id);
  end if;

  if v_prof.entitlement_source = 'license' then
    update public.stripe_events set outcome = 'kept-license' where id = v_event;
    return jsonb_build_object('outcome', 'kept-license', 'accountId', v_prof.id);
  end if;

  if v_prof.entitlement_source = 'stripe'
     or (coalesce(p_subscription_id, '') <> '' and v_prof.stripe_subscription_id = p_subscription_id) then
    update public.profiles set
      plan = 'free',
      plan_expires_at = null,
      stripe_subscription_id = null,
      entitlement_source = null,
      billing_status = case
        when coalesce(p_event_type, '') ilike '%expired%' then 'expired'
        when coalesce(p_event_type, '') ilike '%paused%' then 'paused'
        when coalesce(p_event_type, '') ilike '%deleted%'
          or coalesce(p_event_type, '') ilike '%canceled%' then 'canceled'
        when coalesce(p_event_type, '') ilike '%action_required%' then 'action_required'
        when coalesce(p_event_type, '') ilike '%failed%' then 'failed'
        when coalesce(p_event_type, '') ilike '%unpaid%' then 'unpaid'
        else 'past_due'
      end,
      billing_status_at = now(),
      last_stripe_event_type = coalesce(p_event_type, '')
    where id = v_prof.id;
    update public.stripe_events set outcome = 'revoked' where id = v_event;
    return jsonb_build_object('outcome', 'revoked', 'accountId', v_prof.id);
  end if;

  update public.stripe_events set outcome = 'ignored' where id = v_event;
  return jsonb_build_object('outcome', 'ignored', 'accountId', v_prof.id);
end $$;

revoke all on function public.apply_stripe_entitlement(text, text, boolean, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_entitlement(text, text, boolean, uuid, text, text, text, timestamptz)
  to service_role;

revoke all on table public.stripe_events from anon, public;

-- ============================================================
-- PART 6 — One-time review reward (3 days of Pro+)
-- A signed-in account can leave one testimonial and receive
-- three days of Pro+. The unique owner_id row is the lock:
-- a second call cannot insert and cannot extend the gift.
-- ============================================================

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

create or replace function public.claim_review_reward(p_name text, p_quote text)
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
