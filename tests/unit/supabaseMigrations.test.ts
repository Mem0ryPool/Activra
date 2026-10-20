import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const schema = read('supabase/migrations/20261017000100_phase5b_auth_sync_schema.sql')
const access = read('supabase/migrations/20261017000200_phase5b_auth_sync_rls.sql')
const databaseTest = read('supabase/tests/database/phase5b_rls.test.sql')
const tables = [
  'accounts',
  'sync_state',
  'sync_devices',
  'sync_revisions',
  'sync_entities',
  'sync_tombstones',
  'sync_idempotency'
]

describe('Phase 5B Supabase migrations', () => {
  it('defines every account-scoped sync table and enables RLS on each one', () => {
    for (const table of tables) {
      expect(schema, table).toContain(`create table public.${table}`)
      expect(access, table).toContain(`alter table public.${table} enable row level security`)
      expect(access, table).toContain(`revoke all on table public.${table} from anon, authenticated`)
    }
  })

  it('grants only owner-scoped reads and keeps mutation behind hardened RPCs', () => {
    for (const table of tables.filter((table) => table !== 'sync_idempotency')) {
      expect(access, table).toMatch(new RegExp(`create policy ${table}_select_own[\\s\\S]+?to authenticated[\\s\\S]+?auth\\.uid\\(\\)`))
    }
    expect(access).not.toMatch(/grant\s+(?:insert|update|delete|all)/i)
    expect(access).not.toMatch(/to\s+anon/i)
    expect(access).toMatch(/create function public\.apply_sync_operation[\s\S]+?security definer[\s\S]+?set search_path = ''/)
    expect(access).toContain("v_account uuid := (select auth.uid())")
  })

  it('contracts account isolation, idempotent replay, revisions, and tombstones in pgTAP', () => {
    expect(databaseTest).toContain("pg_temp.authenticate_as('a0000000-0000-4000-8000-000000000001')")
    expect(databaseTest).toContain("pg_temp.authenticate_as('a0000000-0000-4000-8000-000000000002')")
    expect(databaseTest).not.toContain('tests.')
    expect(databaseTest).toContain('other account cannot read owner entities')
    expect(databaseTest).toContain('retrying the same operation is idempotent')
    expect(databaseTest).toContain('delete leaves a tombstone')
  })

  it('contains no committed Supabase secret or JWT-shaped credential', () => {
    const files = [schema, access, databaseTest, read('src/main/auth/otpProvider.ts'), read('src/main/auth/mockOtpDelivery.ts')]
    for (const file of files) {
      expect(file).not.toMatch(/SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY\s*=/)
      expect(file).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./)
    }
  })
})
