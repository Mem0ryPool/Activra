begin;

alter table public.accounts enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_devices enable row level security;
alter table public.sync_revisions enable row level security;
alter table public.sync_entities enable row level security;
alter table public.sync_tombstones enable row level security;
alter table public.sync_idempotency enable row level security;

revoke all on table public.accounts from anon, authenticated;
revoke all on table public.sync_state from anon, authenticated;
revoke all on table public.sync_devices from anon, authenticated;
revoke all on table public.sync_revisions from anon, authenticated;
revoke all on table public.sync_entities from anon, authenticated;
revoke all on table public.sync_tombstones from anon, authenticated;
revoke all on table public.sync_idempotency from anon, authenticated;

grant select on table public.accounts to authenticated;
grant select on table public.sync_state to authenticated;
grant select on table public.sync_devices to authenticated;
grant select on table public.sync_revisions to authenticated;
grant select on table public.sync_entities to authenticated;
grant select on table public.sync_tombstones to authenticated;

create policy accounts_select_own on public.accounts
for select to authenticated
using ((select auth.uid()) = id);

create policy sync_state_select_own on public.sync_state
for select to authenticated
using ((select auth.uid()) = account_id);

create policy sync_devices_select_own on public.sync_devices
for select to authenticated
using ((select auth.uid()) = account_id);

create policy sync_revisions_select_own on public.sync_revisions
for select to authenticated
using ((select auth.uid()) = account_id);

create policy sync_entities_select_own on public.sync_entities
for select to authenticated
using ((select auth.uid()) = account_id);

create policy sync_tombstones_select_own on public.sync_tombstones
for select to authenticated
using ((select auth.uid()) = account_id);

create function public.set_sync_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := (select auth.uid());
begin
  if v_account is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_version is null or char_length(p_version) not between 1 and 64 then
    raise exception 'invalid_consent_version' using errcode = '22023';
  end if;
  update public.accounts
  set sync_consent_version = p_version, sync_consented_at = now()
  where id = v_account and deletion_requested_at is null;
  if not found then
    raise exception 'account_unavailable' using errcode = '55000';
  end if;
end;
$$;

create function public.withdraw_sync_consent()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := (select auth.uid());
begin
  if v_account is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  update public.accounts
  set sync_consent_version = null, sync_consented_at = null
  where id = v_account;
end;
$$;

create function public.register_sync_device(p_device_id uuid, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := (select auth.uid());
begin
  if v_account is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_device_id is null or p_platform not in ('win32', 'darwin') then
    raise exception 'invalid_device' using errcode = '22023';
  end if;
  insert into public.sync_devices (account_id, device_id, platform)
  values (v_account, p_device_id, p_platform)
  on conflict (account_id, device_id) do update
  set platform = excluded.platform, last_seen_at = now()
  where public.sync_devices.revoked_at is null;
  if not found then
    raise exception 'device_revoked' using errcode = '42501';
  end if;
end;
$$;

create function public.apply_sync_operation(
  p_operation_id uuid,
  p_device_id uuid,
  p_device_sequence bigint,
  p_base_revision bigint,
  p_entity_type public.sync_entity_kind,
  p_entity_id text,
  p_mutation public.sync_mutation_kind,
  p_payload jsonb default null
)
returns table (revision bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := (select auth.uid());
  v_current_revision bigint;
  v_entity_revision bigint;
  v_existing_hash text;
  v_existing_revision bigint;
  v_hash text;
  v_last_sequence bigint;
begin
  if v_account is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_operation_id is null or p_device_id is null or p_device_sequence <= 0 or p_base_revision < 0 then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  if p_entity_id is null or p_entity_id !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'invalid_entity_id' using errcode = '22023';
  end if;
  if (p_mutation = 'upsert' and (p_payload is null or jsonb_typeof(p_payload) <> 'object'))
    or (p_mutation = 'delete' and p_payload is not null)
    or (p_payload is not null and pg_column_size(p_payload) > 1048576) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  v_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'device_id', p_device_id,
          'device_sequence', p_device_sequence,
          'base_revision', p_base_revision,
          'entity_type', p_entity_type,
          'entity_id', p_entity_id,
          'mutation', p_mutation,
          'payload', p_payload
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  select i.request_hash, i.applied_revision
  into v_existing_hash, v_existing_revision
  from public.sync_idempotency i
  where i.account_id = v_account and i.operation_id = p_operation_id;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return query select v_existing_revision, true;
    return;
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = v_account and a.sync_consented_at is not null and a.deletion_requested_at is null
  ) then
    raise exception 'sync_consent_required' using errcode = '42501';
  end if;

  select d.last_sequence into v_last_sequence
  from public.sync_devices d
  where d.account_id = v_account and d.device_id = p_device_id and d.revoked_at is null
  for update;
  if not found then
    raise exception 'unknown_or_revoked_device' using errcode = '42501';
  end if;
  if p_device_sequence <> v_last_sequence + 1 then
    raise exception 'device_sequence_out_of_order' using errcode = '22023';
  end if;

  select s.current_revision into v_current_revision
  from public.sync_state s
  where s.account_id = v_account
  for update;
  if p_base_revision > v_current_revision then
    raise exception 'base_revision_ahead' using errcode = '22023';
  end if;

  select greatest(
    coalesce((select e.revision from public.sync_entities e
      where e.account_id = v_account and e.entity_type = p_entity_type and e.entity_id = p_entity_id), 0),
    coalesce((select t.deleted_revision from public.sync_tombstones t
      where t.account_id = v_account and t.entity_type = p_entity_type and t.entity_id = p_entity_id), 0)
  ) into v_entity_revision;
  if v_entity_revision > p_base_revision then
    raise exception 'sync_conflict' using errcode = '40001';
  end if;
  if p_mutation = 'upsert' and exists (
    select 1 from public.sync_tombstones t
    where t.account_id = v_account and t.entity_type = p_entity_type and t.entity_id = p_entity_id
  ) then
    raise exception 'entity_deleted' using errcode = '55000';
  end if;

  v_current_revision := v_current_revision + 1;
  update public.sync_state
  set current_revision = v_current_revision, updated_at = now()
  where account_id = v_account;

  insert into public.sync_revisions (
    account_id, revision, operation_id, device_id, device_sequence, base_revision,
    entity_type, entity_id, mutation, payload
  ) values (
    v_account, v_current_revision, p_operation_id, p_device_id, p_device_sequence, p_base_revision,
    p_entity_type, p_entity_id, p_mutation, p_payload
  );

  if p_mutation = 'upsert' then
    insert into public.sync_entities (account_id, entity_type, entity_id, revision, payload)
    values (v_account, p_entity_type, p_entity_id, v_current_revision, p_payload)
    on conflict (account_id, entity_type, entity_id) do update
    set revision = excluded.revision, payload = excluded.payload, updated_at = now();
  else
    delete from public.sync_entities
    where account_id = v_account and entity_type = p_entity_type and entity_id = p_entity_id;
    insert into public.sync_tombstones (account_id, entity_type, entity_id, deleted_revision)
    values (v_account, p_entity_type, p_entity_id, v_current_revision);
  end if;

  insert into public.sync_idempotency (
    account_id, operation_id, device_id, device_sequence, request_hash, applied_revision
  ) values (
    v_account, p_operation_id, p_device_id, p_device_sequence, v_hash, v_current_revision
  );
  update public.sync_devices
  set last_sequence = p_device_sequence, last_seen_at = now()
  where account_id = v_account and device_id = p_device_id;

  return query select v_current_revision, false;
end;
$$;

revoke all on function public.create_activra_account() from public, anon, authenticated;
revoke all on function public.set_sync_consent(text) from public, anon, authenticated;
revoke all on function public.withdraw_sync_consent() from public, anon, authenticated;
revoke all on function public.register_sync_device(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_sync_operation(uuid, uuid, bigint, bigint, public.sync_entity_kind, text, public.sync_mutation_kind, jsonb) from public, anon, authenticated;

grant execute on function public.set_sync_consent(text) to authenticated;
grant execute on function public.withdraw_sync_consent() to authenticated;
grant execute on function public.register_sync_device(uuid, text) to authenticated;
grant execute on function public.apply_sync_operation(uuid, uuid, bigint, bigint, public.sync_entity_kind, text, public.sync_mutation_kind, jsonb) to authenticated;

commit;
