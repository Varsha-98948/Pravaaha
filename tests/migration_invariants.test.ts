import { describe, expect, it } from 'vitest'

import migration002 from '../supabase/migrations/002_security_and_audit.sql?raw'
import migration003 from '../supabase/migrations/003_operational_text_ids.sql?raw'

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

describe('migration foreign-key invariants', () => {
  it('replaces the original single-column FKs before adding organization-scoped FKs', () => {
    const sql = compact(migration002)

    for (const constraint of [
      'vehicles_depot_id_fkey',
      'deliveries_location_id_fkey',
      'plans_parent_plan_id_fkey',
      'plan_stops_plan_id_fkey',
      'plan_stops_vehicle_id_fkey',
      'plan_stops_delivery_id_fkey',
      'disruptions_confirmed_by_fkey',
    ]) {
      expect(sql).toContain(`drop constraint if exists ${constraint}`)
    }
  })

  it('nulls only nullable relationship columns on composite-FK deletes', () => {
    const sql = compact(migration002)

    expect(sql).toContain('references plans(id, org_id) on delete set null (parent_plan_id)')
    expect(sql).toContain('references profiles(id, org_id) on delete set null (confirmed_by)')
  })

  it('repairs the legacy confirmed_by constraints when migration 003 follows the old 002', () => {
    const sql = compact(migration003)

    expect(sql).toContain('drop constraint if exists disruptions_confirmed_by_fkey')
    expect(sql).toContain('drop constraint if exists disruptions_confirmed_by_org_fk')
    expect(sql).toContain('add constraint disruptions_confirmed_by_org_fk foreign key (confirmed_by, org_id) references profiles(id, org_id) on delete set null (confirmed_by)')
  })

  it('drops the declared UUID RPC signatures before defining their text-ID replacements', () => {
    const sql = compact(migration003)

    expect(sql).toContain('drop function if exists confirm_disruption_tx(uuid, text, text, jsonb, int)')
    expect(sql).toContain('create or replace function confirm_disruption_tx( p_disruption_id text,')
    expect(sql).toContain('drop function if exists record_audit_log(text, text, uuid, uuid, uuid, jsonb)')
    expect(sql).toContain('create or replace function record_audit_log( p_action text, p_entity_type text, p_entity_id text')
  })
})
