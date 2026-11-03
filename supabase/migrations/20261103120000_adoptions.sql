-- Tree adoption: a company pays the planter of a verified tree a fixed price in existing ECOIN (never a mint).
-- One adoption per tree; the primary key on claim_id is the lock against paying twice.
create table if not exists public.adoptions (
  claim_id uuid primary key references public.claims(id),
  business_id text not null references public.accounts(id),
  planter_id text not null references public.accounts(id),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);
alter table public.adoptions enable row level security;

create or replace view public.public_adoptions as
  select a.claim_id, a.business_id, b.name as business_name, a.planter_id, a.amount, a.created_at
  from public.adoptions a join public.accounts b on b.id = a.business_id;
grant select on public.public_adoptions to anon, authenticated;
