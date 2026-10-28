alter table public.evidence add column if not exists phash text;
alter table public.listings add column if not exists photo_phash text;
create index if not exists evidence_phash_idx on public.evidence (phash) where phash is not null;
create index if not exists listings_photo_phash_idx on public.listings (photo_phash) where photo_phash is not null;
