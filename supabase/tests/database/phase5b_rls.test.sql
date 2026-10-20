begin;

-- Self-contained: needs only pgTAP, no third-party test helper schema.
create extension if not exists pgtap with schema extensions;

-- Signs in as a test user the way PostgREST does: authenticated role + JWT claims for auth.uid().
create function pg_temp.authenticate_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

select plan(24);

select ok((select relrowsecurity from pg_class where oid = 'public.accounts'::regclass), 'RLS is enabled on public.accounts');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_state'::regclass), 'RLS is enabled on public.sync_state');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_devices'::regclass), 'RLS is enabled on public.sync_devices');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_revisions'::regclass), 'RLS is enabled on public.sync_revisions');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_entities'::regclass), 'RLS is enabled on public.sync_entities');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_tombstones'::regclass), 'RLS is enabled on public.sync_tombstones');
select ok((select relrowsecurity from pg_class where oid = 'public.sync_idempotency'::regclass), 'RLS is enabled on public.sync_idempotency');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@example.test', '{}', '{}', now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other@example.test', '{}', '{}', now(), now());
select pg_temp.authenticate_as('a0000000-0000-4000-8000-000000000001');

select is((select count(*) from public.accounts), 1::bigint, 'owner sees one account row');
select is(
  (select count(*) from public.accounts where id = 'a0000000-0000-4000-8000-000000000002'),
  0::bigint,
  'owner cannot read another account'
);
select ok(
  not has_table_privilege('authenticated', 'public.sync_entities', 'INSERT'),
  'authenticated clients cannot bypass the sync RPC with direct inserts'
);
select lives_ok($$select public.set_sync_consent('test-v1')$$, 'owner can record explicit sync consent');
select is(
  (select sync_consent_version from public.accounts),
  'test-v1',
  'consent version is recorded on the owner account'
);
select lives_ok(
  $$select public.register_sync_device('10000000-0000-4000-8000-000000000001', 'win32')$$,
  'owner can register a device'
);
select results_eq(
  $$select revision, replayed from public.apply_sync_operation(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    1, 0, 'task', 'task-1', 'upsert', '{"title":"Mine"}'::jsonb
  )$$,
  $$values (1::bigint, false)$$,
  'first operation creates revision one'
);
select is((select count(*) from public.sync_entities), 1::bigint, 'owner reads the canonical entity');
select results_eq(
  $$select revision, replayed from public.apply_sync_operation(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    1, 0, 'task', 'task-1', 'upsert', '{"title":"Mine"}'::jsonb
  )$$,
  $$values (1::bigint, true)$$,
  'retrying the same operation is idempotent'
);
select results_eq(
  $$select revision, replayed from public.apply_sync_operation(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    2, 1, 'task', 'task-1', 'delete', null
  )$$,
  $$values (2::bigint, false)$$,
  'delete creates the next revision'
);
select is((select count(*) from public.sync_entities), 0::bigint, 'delete removes the canonical payload');
select is((select count(*) from public.sync_tombstones), 1::bigint, 'delete leaves a tombstone');

select pg_temp.authenticate_as('a0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.sync_entities), 0::bigint, 'other account cannot read owner entities');
select is((select count(*) from public.sync_revisions), 0::bigint, 'other account cannot read owner revisions');
select is((select count(*) from public.sync_tombstones), 0::bigint, 'other account cannot read owner tombstones');
select ok(
  not has_table_privilege('authenticated', 'public.sync_idempotency', 'SELECT'),
  'idempotency hashes are not exposed to authenticated clients'
);
select ok(
  not has_table_privilege('anon', 'public.accounts', 'SELECT'),
  'signed-out clients have no account-table grant'
);

select * from finish();
rollback;
