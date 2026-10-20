begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.sync_entity_kind as enum (
  'task',
  'completion',
  'plan',
  'habit',
  'habit_checkin',
  'focus_session',
  'preference'
);

create type public.sync_mutation_kind as enum ('upsert', 'delete');

create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  sync_consent_version text,
  sync_consented_at timestamptz,
  deletion_requested_at timestamptz,
  constraint accounts_consent_together check (
    (sync_consent_version is null) = (sync_consented_at is null)
  ),
  constraint accounts_consent_version_length check (
    sync_consent_version is null or char_length(sync_consent_version) between 1 and 64
  )
);

create table public.sync_state (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  current_revision bigint not null default 0 check (current_revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.sync_devices (
  account_id uuid not null references public.accounts (id) on delete cascade,
  device_id uuid not null,
  platform text not null check (platform in ('win32', 'darwin')),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_pulled_revision bigint not null default 0 check (last_pulled_revision >= 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (account_id, device_id)
);

create table public.sync_revisions (
  account_id uuid not null references public.accounts (id) on delete cascade,
  revision bigint not null check (revision > 0),
  operation_id uuid not null,
  device_id uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  base_revision bigint not null check (base_revision >= 0),
  entity_type public.sync_entity_kind not null,
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9-]{1,64}$'),
  mutation public.sync_mutation_kind not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  primary key (account_id, revision),
  unique (account_id, operation_id),
  unique (account_id, device_id, device_sequence),
  foreign key (account_id, device_id) references public.sync_devices (account_id, device_id) on delete restrict,
  constraint sync_revisions_payload_shape check (
    (mutation = 'upsert' and payload is not null and jsonb_typeof(payload) = 'object')
    or (mutation = 'delete' and payload is null)
  ),
  constraint sync_revisions_payload_size check (payload is null or pg_column_size(payload) <= 1048576)
);

create table public.sync_entities (
  account_id uuid not null references public.accounts (id) on delete cascade,
  entity_type public.sync_entity_kind not null,
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9-]{1,64}$'),
  revision bigint not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576),
  updated_at timestamptz not null default now(),
  primary key (account_id, entity_type, entity_id),
  foreign key (account_id, revision) references public.sync_revisions (account_id, revision) on delete restrict
);

create table public.sync_tombstones (
  account_id uuid not null references public.accounts (id) on delete cascade,
  entity_type public.sync_entity_kind not null,
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9-]{1,64}$'),
  deleted_revision bigint not null,
  deleted_at timestamptz not null default now(),
  purge_after timestamptz,
  primary key (account_id, entity_type, entity_id),
  foreign key (account_id, deleted_revision) references public.sync_revisions (account_id, revision) on delete restrict,
  constraint sync_tombstones_purge_order check (purge_after is null or purge_after > deleted_at)
);

create table public.sync_idempotency (
  account_id uuid not null references public.accounts (id) on delete cascade,
  operation_id uuid not null,
  device_id uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  applied_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (account_id, operation_id),
  unique (account_id, device_id, device_sequence),
  foreign key (account_id, applied_revision) references public.sync_revisions (account_id, revision) on delete restrict
);

create index sync_revisions_account_created_idx on public.sync_revisions (account_id, created_at);
create index sync_devices_account_seen_idx on public.sync_devices (account_id, last_seen_at);
create index sync_tombstones_account_deleted_idx on public.sync_tombstones (account_id, deleted_at);

create function public.create_activra_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (id, created_at) values (new.id, coalesce(new.created_at, now()))
  on conflict (id) do nothing;
  insert into public.sync_state (account_id) values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_activra
after insert on auth.users
for each row execute function public.create_activra_account();

insert into public.accounts (id, created_at)
select id, coalesce(created_at, now()) from auth.users
on conflict (id) do nothing;

insert into public.sync_state (account_id)
select id from public.accounts
on conflict (account_id) do nothing;

commit;
