-- ECO Climate Action OS — schema (Meta Global AI Developer Hackathon, Oct 2026).
-- Private tables are reachable only by the edge functions (service role).
-- The public sees read-only views: Evidence Files, checks, the ECOIN ledger and stats — never phone numbers.

create table public.accounts (
  id text primary key,                      -- public pseudonym, e.g. eco_3f9a1c...
  phone text not null unique,               -- WhatsApp number or simulator id; never exposed
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sessions (
  account_id text primary key references public.accounts(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.accounts(id),
  protocol text not null check (protocol in ('tree_planting', 'tree_survival', 'cleanup', 'recycling')),
  parent_id uuid references public.claims(id),
  status text not null default 'collecting' check (status in ('collecting', 'verifying', 'consistent', 'unresolved', 'contradicted', 'cancelled')),
  lat double precision,
  lng double precision,
  reward integer not null default 0,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index on public.claims (account_id, created_at desc);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references public.claims(id),
  account_id text not null references public.accounts(id),
  kind text not null check (kind in ('photo', 'location', 'voice')),
  role text,
  path text,
  sha256 text,
  lat double precision,
  lng double precision,
  text text,
  superseded boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.evidence (claim_id);
create index on public.evidence (sha256);
create index on public.evidence (account_id) where claim_id is null;

create table public.checks (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id),
  decision jsonb not null,
  observation jsonb not null,
  counts jsonb not null,
  boxes jsonb not null default '{}'::jsonb,   -- SAM 3.1 boxes per photo role, drawn on the Evidence File
  models jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.checks (claim_id, created_at desc);

create table public.ledger (
  seq bigint primary key,
  prev_hash text not null,
  hash text not null unique,
  account_id text not null references public.accounts(id),
  amount integer not null,
  kind text not null check (kind in ('reward', 'spend', 'adjustment')),
  claim_id uuid references public.claims(id),
  memo text not null default '',
  at text not null
);

create table public.seen_messages (id text primary key, at timestamptz not null default now());
create table public.usage (day date not null, bucket text not null, n integer not null default 0, primary key (day, bucket));

alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.claims enable row level security;
alter table public.evidence enable row level security;
alter table public.checks enable row level security;
alter table public.ledger enable row level security;
alter table public.seen_messages enable row level security;
alter table public.usage enable row level security;

-- Append-only: checks and the ledger can never be edited or deleted.
create function public.eco_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger checks_append_only before update or delete on public.checks for each row execute function public.eco_append_only();
create trigger checks_no_truncate before truncate on public.checks for each statement execute function public.eco_append_only();
create trigger ledger_append_only before update or delete on public.ledger for each row execute function public.eco_append_only();
create trigger ledger_no_truncate before truncate on public.ledger for each statement execute function public.eco_append_only();

-- Hash-chained append. The canonical string matches canonical() in _core/ledger.ts exactly.
create function public.ledger_append(p_account text, p_amount integer, p_kind text, p_claim uuid, p_memo text)
returns public.ledger language plpgsql security definer set search_path = public as $$
declare
  last public.ledger;
  r public.ledger;
begin
  lock table public.ledger in exclusive mode;
  select * into last from public.ledger order by seq desc limit 1;
  r.seq := coalesce(last.seq, 0) + 1;
  r.prev_hash := coalesce(last.hash, repeat('0', 64));
  r.account_id := p_account;
  r.amount := p_amount;
  r.kind := p_kind;
  r.claim_id := p_claim;
  r.memo := coalesce(p_memo, '');
  r.at := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  r.hash := encode(sha256(convert_to(
    r.seq::text || '|' || r.prev_hash || '|' || r.account_id || '|' || r.amount::text || '|' || r.kind || '|' ||
    coalesce(r.claim_id::text, '') || '|' || r.memo || '|' || r.at, 'UTF8')), 'hex');
  insert into public.ledger values (r.*);
  return r;
end $$;
revoke all on function public.ledger_append from public, anon, authenticated;

-- Usage counter for cost caps (atomic increment, returns the new count).
create function public.usage_bump(p_bucket text) returns integer language sql security definer set search_path = public as $$
  insert into public.usage (day, bucket, n) values (current_date, p_bucket, 1)
  on conflict (day, bucket) do update set n = public.usage.n + 1
  returning n;
$$;
revoke all on function public.usage_bump from public, anon, authenticated;

-- ───── Public, read-only views (no phone numbers) ─────
create view public.public_claims as
  select id, account_id, protocol, parent_id, status, reward, created_at, verified_at,
         round(lat::numeric, 4) as lat, round(lng::numeric, 4) as lng
  from public.claims where status in ('consistent', 'unresolved', 'contradicted');

create view public.public_evidence as
  select e.claim_id, e.role, e.path, e.sha256, e.created_at
  from public.evidence e join public.public_claims c on c.id = e.claim_id
  where e.kind = 'photo' and not e.superseded;

create view public.public_checks as
  select k.claim_id, k.decision, k.observation, k.counts, k.boxes, k.models, k.created_at
  from public.checks k join public.public_claims c on c.id = k.claim_id;

create view public.public_ledger as select * from public.ledger;

create view public.public_stats as
  select
    (select count(*) from public.claims where status = 'consistent') as verified_actions,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'tree_planting') as trees_planted,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'tree_survival') as trees_alive_30d,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'cleanup') as cleanups,
    (select coalesce(sum((k.counts->>'items')::int), 0) from public.checks k join public.claims c on c.id = k.claim_id
       where c.protocol = 'recycling' and c.status = 'consistent' and k.decision->>'outcome' = 'consistent') as items_recycled,
    (select count(*) from public.claims where status in ('unresolved', 'contradicted')) as claims_not_paid,
    (select coalesce(sum(amount), 0) from public.ledger where kind = 'reward') as ecoin_issued,
    (select count(distinct account_id) from public.ledger) as people_paid;

grant select on public.public_claims, public.public_evidence, public.public_checks, public.public_ledger, public.public_stats to anon, authenticated;

-- Evidence photos: public bucket (people agree to this before their first claim).
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', true) on conflict (id) do nothing;
