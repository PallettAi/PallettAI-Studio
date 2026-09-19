-- ============================================================
-- PallettAI Studio — client review links
-- A client reviews a built site at a token link: opens the page,
-- pins comments to sections, approves or requests changes.
--
-- The token IS the grant. The client never signs up or signs in;
-- every write validates an unexpired, unrevoked token server-side
-- inside SECURITY DEFINER functions (the tables themselves stay
-- RLS-denied to anon). Paste the whole file into Supabase → SQL
-- Editor → Run once. Re-running is safe (idempotent).
-- ============================================================

-- ---------- 0. Hashing (pgcrypto supplies digest(); Supabase has it pre-enabled) ----------
create extension if not exists pgcrypto;

-- ---------- 1. The studio's review links ----------
create table if not exists public.review_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  project_name text not null default '',
  token_hash text not null unique,        -- sha256 hex of the link token; the token itself never lands here
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists review_links_owner_idx on public.review_links (owner_id);

-- ---------- 2. Pinned comments ----------
create table if not exists public.review_comments (
  id bigint generated always as identity primary key,
  review_id uuid not null references public.review_links (id) on delete cascade,
  page_id text not null default '',
  section_id text not null default '',
  author text not null default '',
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists review_comments_review_idx on public.review_comments (review_id);

-- ---------- 3. Approvals / change requests ----------
create table if not exists public.review_approvals (
  id bigint generated always as identity primary key,
  review_id uuid not null references public.review_links (id) on delete cascade,
  decision text not null check (decision in ('approved', 'changes-requested')),
  author text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- 4. Row-level security ----------
-- No policy is created for the anon role on any of these tables: every direct
-- SELECT/INSERT is refused, and the only path in is the RPCs below, which
-- authenticate with the review token, not a session.
alter table public.review_links enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_approvals enable row level security;

-- The studio reads its own reviews (comments + approvals + status) when signed in.
drop policy if exists "own reviews" on public.review_links;
create policy "own reviews" on public.review_links
  for select to authenticated using (auth.uid() = owner_id);
drop policy if exists "own review comments" on public.review_comments;
create policy "own review comments" on public.review_comments
  for select to authenticated using (
    exists (select 1 from public.review_links l where l.id = review_id and l.owner_id = auth.uid())
  );
drop policy if exists "own review approvals" on public.review_approvals;
create policy "own review approvals" on public.review_approvals
  for select to authenticated using (
    exists (select 1 from public.review_links l where l.id = review_id and l.owner_id = auth.uid())
  );

-- ---------- 5. Token helpers ----------
create or replace function public.review_token_hash(p_token text)
returns text language sql immutable as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- ---------- 6. Create a review link (signed-in studio owner) ----------
create or replace function public.create_review_link(
  p_project_id text, p_project_name text, p_token_hash text, p_days int default 14
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_days int := greatest(1, least(60, coalesce(p_days, 14)));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'msg', 'Sign in to create review links.');
  end if;
  if coalesce(p_token_hash, '') = '' or length(p_token_hash) <> 64 then
    return jsonb_build_object('ok', false, 'msg', 'Missing or malformed link token.');
  end if;
  insert into public.review_links (owner_id, project_id, project_name, token_hash, expires_at)
  values (auth.uid(), left(coalesce(p_project_id, ''), 80), left(coalesce(p_project_name, ''), 120),
          p_token_hash, now() + make_interval(days => v_days))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'expiresAt', to_char(
    (select expires_at from public.review_links where id = v_id), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- ---------- 7. Client writes: one validated path each ----------
-- Every client write validates the token: correct link, not revoked, not
-- expired. Anything else is 'invalid-link' — the RPC never reveals WHY.

create or replace function public.submit_review_comment(
  p_token text, p_review_id text, p_page_id text, p_section_id text, p_author text, p_body text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links%rowtype;
  v_body text := left(coalesce(p_body, ''), 600);
begin
  if coalesce(trim(v_body), '') = '' then
    return jsonb_build_object('ok', false, 'msg', 'Write a comment first.');
  end if;
  select * into v_link from public.review_links
    where token_hash = public.review_token_hash(p_token)
      and id::text = left(coalesce(p_review_id, ''), 80)
      and revoked_at is null
      and expires_at > now()
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'msg', 'This review link is no longer active.');
  end if;
  insert into public.review_comments (review_id, page_id, section_id, author, body)
  values (v_link.id, left(coalesce(p_page_id, ''), 80), left(coalesce(p_section_id, ''), 80),
          left(coalesce(p_author, ''), 60), v_body);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.submit_review_approval(
  p_token text, p_review_id text, p_decision text, p_author text, p_note text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_link public.review_links%rowtype;
begin
  if coalesce(p_decision, '') not in ('approved', 'changes-requested') then
    return jsonb_build_object('ok', false, 'msg', 'Unknown decision.');
  end if;
  select * into v_link from public.review_links
    where token_hash = public.review_token_hash(p_token)
      and id::text = left(coalesce(p_review_id, ''), 80)
      and revoked_at is null
      and expires_at > now()
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'msg', 'This review link is no longer active.');
  end if;
  insert into public.review_approvals (review_id, decision, author, note)
  values (v_link.id, p_decision, left(coalesce(p_author, ''), 60), left(coalesce(p_note, ''), 400));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 8. The studio pulls its reviews ----------
-- Returns every comment/approval for links the caller owns. Called with the
-- signed-in session (RLS would allow the same via joins, but one RPC keeps
-- the client simple and lets the server cap the rows).
create or replace function public.list_my_reviews()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_links jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'msg', 'Not signed in.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'projectId', l.project_id,
    'projectName', l.project_name,
    'createdAt', l.created_at,
    'expiresAt', l.expires_at,
    'revoked', l.revoked_at is not null,
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'pageId', c.page_id, 'sectionId', c.section_id,
        'author', c.author, 'body', c.body, 'resolved', c.resolved, 'createdAt', c.created_at
      ) order by c.created_at), '[]'::jsonb)
      from public.review_comments c where c.review_id = l.id
    ),
    'approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'decision', a.decision, 'author', a.author, 'note', a.note, 'createdAt', a.created_at
      ) order by a.created_at), '[]'::jsonb)
      from public.review_approvals a where a.review_id = l.id
    )
  ) order by l.created_at desc), '[]'::jsonb)
  into v_links
  from public.review_links l
  where l.owner_id = auth.uid();
  return jsonb_build_object('ok', true, 'reviews', v_links);
end $$;

-- ---------- 9. Revoke / extend ----------
create or replace function public.revoke_review_link(p_review_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'msg', 'Not signed in.');
  end if;
  update public.review_links set revoked_at = now()
    where id::text = left(coalesce(p_review_id, ''), 80) and owner_id = auth.uid() and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'msg', 'Review link not found (or already revoked).');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.extend_review_link(p_review_id text, p_days int)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'msg', 'Not signed in.');
  end if;
  update public.review_links
    set expires_at = greatest(expires_at, now()) + make_interval(days => greatest(1, least(60, coalesce(p_days, 14))))
    where id::text = left(coalesce(p_review_id, ''), 80) and owner_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'msg', 'Review link not found.');
  end if;
  return jsonb_build_object('ok', true, 'expiresAt', to_char(
    (select expires_at from public.review_links
      where id::text = left(coalesce(p_review_id, ''), 80) and owner_id = auth.uid()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;
