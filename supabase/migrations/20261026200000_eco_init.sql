-- ECO · Proof of Planet — schema (Meta Global AI Developer Hackathon, Oct 26 – Nov 4, 2026).
-- Witness (verified climate action), Loop (recyclables marketplace + escrow), Glance (payments),
-- Atlas (funder intelligence) and the hash-chained ECOIN ledger with an audited Reserve.
-- Private tables are reachable only by the edge functions (service role). The public sees read-only
-- views — Evidence Files, trades, the ledger, stats and Atlas — never phone numbers.

create table public.accounts (
  id text primary key,                      -- public pseudonym, e.g. eco_3f9a1c...
  phone text not null unique,               -- WhatsApp number or simulator number; never exposed
  name text,                                -- businesses and shops only
  roles text[] not null default '{person}',
  consent_at timestamptz,
  created_at timestamptz not null default now()
);
insert into public.accounts (id, phone, name, roles) values
  ('eco_escrow', 'system:escrow', 'ECO Escrow', '{}'),
  ('eco_treasury', 'system:treasury', 'ECO Treasury (fee revenue)', '{}'),
  ('eco_reserve', 'system:reserve', 'ECO Reserve', '{}');

create table public.sessions (
  account_id text primary key references public.accounts(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ───── Witness ─────
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

-- ───── Loop ─────
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller text not null references public.accounts(id),
  material text not null,
  quantity integer not null,
  unit text not null,
  price integer not null default 0,
  grade text,
  sam_count integer not null default 0,
  photo_path text,
  photo_sha256 text,
  lat double precision,
  lng double precision,
  status text not null check (status in ('draft', 'open', 'reserved', 'sold', 'cancelled')),
  assessment jsonb,
  created_at timestamptz not null default now()
);
create index on public.listings (material, status);
create index on public.listings (photo_sha256);

create table public.demands (
  id uuid primary key default gen_random_uuid(),
  buyer text not null references public.accounts(id),
  material text not null,
  quantity integer not null,
  max_price integer not null,
  lat double precision,
  lng double precision,
  radius_km double precision not null default 25,
  status text not null check (status in ('open', 'filled', 'cancelled')),
  created_at timestamptz not null default now()
);
create index on public.demands (material, status);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  demand_id uuid not null references public.demands(id),
  seller text not null references public.accounts(id),
  buyer text not null references public.accounts(id),
  material text not null,
  quantity integer not null,
  unit text not null,
  price integer not null,
  total integer not null,
  distance_km double precision,
  status text not null check (status in ('proposed', 'escrowed', 'delivered', 'released', 'disputed', 'refunded', 'settled', 'declined')),
  delivery_photo_path text,
  dispute jsonb,
  mediation jsonb,     -- Muse Spark's recommendation (advice only)
  decision jsonb,      -- the human reviewer's decision
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.trades (seller);
create index on public.trades (buyer);
create index on public.trades (status);

-- ───── Glance ─────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shop text not null references public.accounts(id),
  customer text not null references public.accounts(id),
  amount integer not null check (amount > 0),
  status text not null check (status in ('pending', 'paid', 'expired', 'failed', 'cancelled')),
  method text not null default 'whatsapp_code',
  code_hash text not null,   -- salted SHA-256 of the one-time code; the code itself is never stored
  attempts integer not null default 0,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.payments (shop, status);

-- ───── Ledger ─────
create table public.ledger (
  seq bigint primary key,
  prev_hash text not null,
  hash text not null unique,
  account_id text not null references public.accounts(id),
  amount integer not null,
  kind text not null check (kind in ('reward', 'deposit', 'trade', 'escrow', 'payment', 'fee', 'reserve')),
  ref text,          -- claim, trade or payment id
  memo text not null default '',
  at text not null
);
create index on public.ledger (account_id);
create index on public.ledger (ref);

-- ───── plumbing ─────
create table public.outbox (id bigserial primary key, account_id text not null references public.accounts(id), text text not null, created_at timestamptz not null default now(), delivered_at timestamptz);
create index on public.outbox (account_id) where delivered_at is null;
create table public.seen_messages (id text primary key, at timestamptz not null default now());
create table public.usage (day date not null, bucket text not null, n integer not null default 0, primary key (day, bucket));
create table public.briefs (id bigserial primary key, kind text not null, body jsonb not null, created_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['accounts','sessions','claims','evidence','checks','listings','demands','trades','payments','ledger','outbox','seen_messages','usage','briefs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Append-only: Witness checks and the ledger can never be edited or deleted.
create function public.eco_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger checks_append_only before update or delete on public.checks for each row execute function public.eco_append_only();
create trigger checks_no_truncate before truncate on public.checks for each statement execute function public.eco_append_only();
create trigger ledger_append_only before update or delete on public.ledger for each row execute function public.eco_append_only();
create trigger ledger_no_truncate before truncate on public.ledger for each statement execute function public.eco_append_only();

-- Posts a set of legs atomically, under the same rules as checkLegs() in _core/ledger.ts:
-- minting (reward/deposit) only credits; every transfer sums to zero; no account may go below zero.
-- Each entry's hash matches canonical() in _core/ledger.ts, so browsers can re-check the chain.
create function public.ledger_post(p_legs jsonb, p_ref text, p_memo text)
returns setof public.ledger language plpgsql security definer set search_path = public as $$
declare
  leg jsonb;
  last public.ledger;
  r public.ledger;
  v_at text;
  v_all_mint boolean;
  v_any_mint boolean;
  v_sum numeric;
begin
  if p_legs is null or jsonb_array_length(p_legs) = 0 then raise exception 'no legs'; end if;
  lock table public.ledger in exclusive mode;
  if exists (select 1 from jsonb_array_elements(p_legs) l
             where (l->>'amount')::numeric = 0 or (l->>'amount')::numeric <> trunc((l->>'amount')::numeric)) then
    raise exception 'amounts must be non-zero whole ECOIN';
  end if;
  select bool_and(l->>'kind' in ('reward', 'deposit')), bool_or(l->>'kind' in ('reward', 'deposit')), sum((l->>'amount')::numeric)
    into v_all_mint, v_any_mint, v_sum from jsonb_array_elements(p_legs) l;
  if v_all_mint then
    if exists (select 1 from jsonb_array_elements(p_legs) l where (l->>'amount')::numeric < 0) then raise exception 'minting cannot debit'; end if;
  else
    if v_any_mint then raise exception 'mint kinds cannot be mixed with transfers'; end if;
    if v_sum <> 0 then raise exception 'transfer legs must sum to zero'; end if;
  end if;
  if exists (
    select 1 from (select l->>'account_id' as a, sum((l->>'amount')::numeric) as n from jsonb_array_elements(p_legs) l group by 1) x
    where x.n < 0 and coalesce((select sum(amount) from public.ledger where account_id = x.a), 0) + x.n < 0
  ) then raise exception 'insufficient ECOIN'; end if;

  v_at := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select * into last from public.ledger order by seq desc limit 1;
  for leg in select value from jsonb_array_elements(p_legs) with ordinality order by ordinality loop
    r.seq := coalesce(last.seq, 0) + 1;
    r.prev_hash := coalesce(last.hash, repeat('0', 64));
    r.account_id := leg->>'account_id';
    r.amount := (leg->>'amount')::integer;
    r.kind := leg->>'kind';
    r.ref := p_ref;
    r.memo := coalesce(p_memo, '');
    r.at := v_at;
    r.hash := encode(sha256(convert_to(
      r.seq::text || '|' || r.prev_hash || '|' || r.account_id || '|' || r.amount::text || '|' || r.kind || '|' ||
      coalesce(r.ref, '') || '|' || r.memo || '|' || r.at, 'UTF8')), 'hex');
    insert into public.ledger values (r.*);
    last := r;
    return next r;
  end loop;
end $$;
revoke all on function public.ledger_post from public, anon, authenticated;

create function public.usage_bump(p_bucket text) returns integer language sql security definer set search_path = public as $$
  insert into public.usage (day, bucket, n) values (current_date, p_bucket, 1)
  on conflict (day, bucket) do update set n = public.usage.n + 1
  returning n;
$$;
revoke all on function public.usage_bump from public, anon, authenticated;

-- ───── Public, read-only views (no phone numbers) ─────
create view public.public_accounts as
  select id, case when roles && '{business,shop}' or phone like 'system:%' then name end as name,
         roles, created_at
  from public.accounts;

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

create view public.public_listings as
  select id, seller, material, quantity, unit, price, grade, sam_count, photo_path, status, assessment, created_at,
         round(lat::numeric, 2) as lat, round(lng::numeric, 2) as lng   -- pickup area (~1 km), not the exact spot
  from public.listings where status <> 'draft';

create view public.public_trades as
  select t.id, t.listing_id, t.seller, t.buyer, b.name as buyer_name, t.material, t.quantity, t.unit, t.price, t.total,
         t.distance_km, t.status, t.delivery_photo_path, t.dispute->>'reason' as dispute_reason, t.mediation, t.decision, t.history, t.created_at
  from public.trades t join public.accounts b on b.id = t.buyer;

create view public.public_ledger as select * from public.ledger;

create view public.public_stats as
  select
    (select count(*) from public.claims where status = 'consistent') as verified_actions,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'tree_planting') as trees_planted,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'tree_survival') as trees_alive_30d,
    (select count(*) from public.claims where status = 'consistent' and protocol = 'cleanup') as cleanups,
    (select count(*) from public.claims where status in ('unresolved', 'contradicted')) as claims_not_paid,
    (select coalesce(sum(quantity), 0) from public.trades where status in ('released', 'settled')) as units_traded,
    (select count(*) from public.trades where status in ('released', 'settled')) as trades_completed,
    (select count(*) from public.payments where status = 'paid') as payments,
    (select coalesce(sum(amount), 0) from public.ledger where kind = 'reward') as ecoin_minted,
    (select coalesce(sum(amount), 0) from public.ledger where account_id = 'eco_reserve') as reserve,
    (select coalesce(sum(amount), 0) from public.ledger where account_id = 'eco_treasury') as fee_revenue,
    (select coalesce(sum(amount), 0) from public.ledger where account_id = 'eco_escrow') as in_escrow,
    (select count(distinct account_id) from public.ledger where kind = 'reward') as people_paid;

-- Atlas: verified activity per ~5 km cell. Integrity = share of checked claims that passed.
create view public.public_atlas as
  with c as (
    select floor(lat / 0.05) * 0.05 + 0.025 as cell_lat, floor(lng / 0.05) * 0.05 + 0.025 as cell_lng, protocol, status, reward
    from public.claims where status in ('consistent', 'unresolved', 'contradicted') and lat is not null
  ), l as (
    select floor(lat / 0.05) * 0.05 + 0.025 as cell_lat, floor(lng / 0.05) * 0.05 + 0.025 as cell_lng, quantity
    from public.listings where status = 'sold' and lat is not null
  )
  select round(cell_lat::numeric, 3) as lat, round(cell_lng::numeric, 3) as lng,
    count(*) filter (where status = 'consistent') as verified,
    count(*) filter (where status = 'consistent' and protocol = 'tree_planting') as trees,
    count(*) filter (where status = 'consistent' and protocol = 'tree_survival') as trees_alive,
    count(*) filter (where status = 'consistent' and protocol = 'cleanup') as cleanups,
    count(*) filter (where status = 'consistent' and protocol = 'recycling') as recycling,
    count(*) filter (where status <> 'consistent') as held_back,
    round(avg(case when status = 'consistent' then 1.0 else 0.0 end), 2) as integrity,
    coalesce(sum(reward), 0) as ecoin,
    coalesce((select sum(quantity) from l where l.cell_lat = c.cell_lat and l.cell_lng = c.cell_lng), 0) as units_traded
  from c group by cell_lat, cell_lng;

create view public.public_brief as select body, created_at from public.briefs where kind = 'atlas' order by created_at desc limit 1;

grant select on public.public_accounts, public.public_claims, public.public_evidence, public.public_checks, public.public_listings,
  public.public_trades, public.public_ledger, public.public_stats, public.public_atlas, public.public_brief to anon, authenticated;

-- Evidence photos: public bucket (people agree to this before their first claim).
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', true) on conflict (id) do nothing;
