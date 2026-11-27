create schema if not exists chillera_market;

create table if not exists chillera_market.market_products (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  brand text,
  manufacturer text,
  product_type text not null default 'flower',
  thc_percent numeric(5,2),
  cbd_percent numeric(5,2),
  pack_size_g numeric(8,2),
  registration_number text,
  active_ingredient text,
  source_url text,
  source_name text,
  verification_status text not null default 'unverified' check (verification_status in ('verified','unverified','disputed')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_name, manufacturer, pack_size_g)
);

create table if not exists chillera_market.market_pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  postal_code text,
  voivodeship text,
  source_url text,
  external_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, address)
);

create table if not exists chillera_market.market_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in ('official_register','pharmacy','wholesaler','partner_api','manual')),
  base_url text,
  adapter text not null default 'json_feed',
  enabled boolean not null default false,
  access_method text not null default 'public',
  terms_reviewed boolean not null default false,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists chillera_market.market_availability (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references chillera_market.market_products(id) on delete cascade,
  pharmacy_id uuid references chillera_market.market_pharmacies(id) on delete cascade,
  source_id uuid references chillera_market.market_sources(id) on delete set null,
  status text not null check (status in ('available','unavailable','unknown','on_request')),
  price_pln numeric(10,2),
  quantity_g numeric(10,2),
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  source_url text,
  evidence jsonb not null default '{}'::jsonb,
  verification_status text not null default 'unverified' check (verification_status in ('verified','unverified','stale','disputed')),
  created_at timestamptz not null default now()
);

create table if not exists chillera_market.market_wholesale_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references chillera_market.market_products(id) on delete cascade,
  supplier_name text not null,
  price_net_pln numeric(10,2),
  price_gross_pln numeric(10,2),
  quantity_g numeric(12,2),
  minimum_order_g numeric(12,2),
  valid_from timestamptz,
  valid_until timestamptz,
  source_id uuid references chillera_market.market_sources(id) on delete set null,
  source_url text,
  access_level text not null default 'b2b' check (access_level in ('b2b','internal')),
  verification_status text not null default 'unverified' check (verification_status in ('verified','unverified','stale','disputed')),
  created_at timestamptz not null default now()
);

create table if not exists chillera_market.market_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references chillera_market.market_sources(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  records_seen integer not null default 0,
  records_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists market_availability_product_observed_idx on chillera_market.market_availability(product_id, observed_at desc);
create index if not exists market_availability_pharmacy_observed_idx on chillera_market.market_availability(pharmacy_id, observed_at desc);
create index if not exists market_products_name_idx on chillera_market.market_products using gin (to_tsvector('simple', canonical_name));
create index if not exists market_wholesale_product_idx on chillera_market.market_wholesale_offers(product_id, created_at desc);

alter table chillera_market.market_products enable row level security;
alter table chillera_market.market_pharmacies enable row level security;
alter table chillera_market.market_sources enable row level security;
alter table chillera_market.market_availability enable row level security;
alter table chillera_market.market_wholesale_offers enable row level security;
alter table chillera_market.market_ingestion_runs enable row level security;

-- Public catalogue and public pharmacy observations only. B2B offers and ingestion logs stay server-side.
create policy "public can read verified catalogue" on chillera_market.market_products
for select to anon, authenticated using (verification_status = 'verified');
create policy "public can read pharmacies" on chillera_market.market_pharmacies
for select to anon, authenticated using (is_active = true);
create policy "public can read verified availability" on chillera_market.market_availability
for select to anon, authenticated using (verification_status = 'verified' and (expires_at is null or expires_at > now()));

grant usage on schema chillera_market to anon, authenticated, service_role;
grant select on chillera_market.market_products, chillera_market.market_pharmacies, chillera_market.market_availability to anon, authenticated;
grant all on all tables in schema chillera_market to service_role;
