-- =============================================================================
-- Migration 003: Convert operational entity IDs from uuid to text
-- =============================================================================
--
-- Background:
--   The TypeScript planning engine uses human-readable string IDs such as
--   'v1', 'd1', 'depot', 'plan-replanned-90'.  Migrations 001–002 created these
--   tables with uuid primary keys, which rejects those IDs at INSERT time.
--
-- Scope of changes:
--   CONVERT to text (operational entities whose IDs originate in the engine):
--     locations.id
--     vehicles.id, vehicles.depot_id
--     deliveries.id, deliveries.location_id
--     plans.id, plans.parent_plan_id
--     plan_stops.id, plan_stops.plan_id, plan_stops.vehicle_id, plan_stops.delivery_id
--     disruptions.id
--     simulation_events.id, simulation_events.plan_id
--     audit_logs.entity_id, audit_logs.plan_id, audit_logs.disruption_id
--   KEEP as uuid (identity managed by Supabase Auth or org bootstrapping):
--     organizations.id
--     profiles.id (references auth.users)
--     audit_logs.id, audit_logs.actor_id (internal log record / auth user)
--     disruptions.confirmed_by (references profiles.id)
--
-- Strategy:
--   1. Drop all FKs that reference columns being converted (children first).
--   2. Drop composite unique constraints on those PKs (required before ALTER).
--   3. Alter each column: uuid → text USING col::text; update defaults.
--   4. Recreate composite unique constraints.
--   5. Recreate all composite and simple FKs.
--   6. Replace confirm_disruption_tx and record_audit_log with text signatures.
--
-- Safety:
--   Existing data is preserved; ::text cast on uuid values is lossless.
--   All names use DROP … IF EXISTS to tolerate partial prior applies safely.
--   profiles.id and organizations.id are untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: Drop composite FKs from child tables (deepest children first)
-- -----------------------------------------------------------------------------

-- plan_stops references plans, vehicles, deliveries
alter table plan_stops
  drop constraint if exists plan_stops_plan_org_fk,
  drop constraint if exists plan_stops_vehicle_org_fk,
  drop constraint if exists plan_stops_delivery_org_fk;

-- audit_logs references plans and disruptions
alter table audit_logs
  drop constraint if exists audit_logs_plan_id_fkey,
  drop constraint if exists audit_logs_disruption_id_fkey;

-- simulation_events references plans
alter table simulation_events
  drop constraint if exists simulation_events_plan_id_fkey;

-- plans self-references (parent_plan_id → plans.id)
alter table plans
  drop constraint if exists plans_parent_org_fk,
  drop constraint if exists plans_parent_plan_id_fkey;

-- vehicles references locations
alter table vehicles
  drop constraint if exists vehicles_depot_org_fk,
  drop constraint if exists vehicles_depot_id_fkey;

-- deliveries references locations
alter table deliveries
  drop constraint if exists deliveries_location_org_fk,
  drop constraint if exists deliveries_location_id_fkey;

-- plan_stops implicit FKs from migration 001 (postgres auto-name: table_col_fkey)
alter table plan_stops
  drop constraint if exists plan_stops_plan_id_fkey,
  drop constraint if exists plan_stops_vehicle_id_fkey,
  drop constraint if exists plan_stops_delivery_id_fkey;

-- disruptions.confirmed_by stays uuid; keep disruptions_confirmed_by_org_fk and
-- disruptions_confirmed_by_fkey intact — they do not reference a column being changed.

-- -----------------------------------------------------------------------------
-- STEP 2: Drop composite unique constraints on PKs being converted
--         (required before ALTER COLUMN on a uniqueness-constrained column)
-- -----------------------------------------------------------------------------

alter table locations   drop constraint if exists locations_id_org_id_uniq;
alter table vehicles    drop constraint if exists vehicles_id_org_id_uniq;
alter table deliveries  drop constraint if exists deliveries_id_org_id_uniq;
alter table plans       drop constraint if exists plans_id_org_id_uniq;
alter table disruptions drop constraint if exists disruptions_id_org_id_uniq;

-- plan_stops has a unique (plan_id, vehicle_id, seq) that uses plan_id and vehicle_id
alter table plan_stops  drop constraint if exists plan_stops_plan_id_vehicle_id_seq_key;

-- -----------------------------------------------------------------------------
-- STEP 3: Alter columns — uuid → text, preserving existing data via ::text cast
-- -----------------------------------------------------------------------------

-- locations
alter table locations
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text;

-- vehicles (both PK and the FK column depot_id)
alter table vehicles
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text,
  alter column depot_id type text using depot_id::text;

-- deliveries (both PK and location_id)
alter table deliveries
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text,
  alter column location_id type text using location_id::text;

-- plans (PK and self-referencing FK)
alter table plans
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text,
  alter column parent_plan_id type text using parent_plan_id::text;

-- plan_stops (PK and three FK columns)
alter table plan_stops
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text,
  alter column plan_id     type text using plan_id::text,
  alter column vehicle_id  type text using vehicle_id::text,
  alter column delivery_id type text using delivery_id::text;

-- disruptions (PK only; confirmed_by stays uuid)
alter table disruptions
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text;

-- simulation_events (PK and plan_id FK)
alter table simulation_events
  alter column id set default gen_random_uuid()::text,
  alter column id type text using id::text,
  alter column plan_id type text using plan_id::text;

-- audit_logs (entity_id, plan_id, disruption_id only; id and actor_id stay uuid)
alter table audit_logs
  alter column entity_id     type text using entity_id::text,
  alter column plan_id       type text using plan_id::text,
  alter column disruption_id type text using disruption_id::text;

-- -----------------------------------------------------------------------------
-- STEP 4: Recreate composite unique constraints
-- -----------------------------------------------------------------------------

alter table locations   add constraint locations_id_org_id_uniq   unique (id, org_id);
alter table vehicles    add constraint vehicles_id_org_id_uniq     unique (id, org_id);
alter table deliveries  add constraint deliveries_id_org_id_uniq   unique (id, org_id);
alter table plans       add constraint plans_id_org_id_uniq        unique (id, org_id);
alter table disruptions add constraint disruptions_id_org_id_uniq  unique (id, org_id);

-- Restore plan_stops uniqueness
alter table plan_stops  add constraint plan_stops_plan_id_vehicle_id_seq_key unique (plan_id, vehicle_id, seq);

-- -----------------------------------------------------------------------------
-- STEP 5: Recreate all foreign keys
-- -----------------------------------------------------------------------------

-- vehicles.depot_id → locations(id, org_id)
alter table vehicles
  add constraint vehicles_depot_org_fk
    foreign key (depot_id, org_id)
    references locations(id, org_id) on delete restrict;

-- deliveries.location_id → locations(id, org_id)
alter table deliveries
  add constraint deliveries_location_org_fk
    foreign key (location_id, org_id)
    references locations(id, org_id) on delete restrict;

-- plans.parent_plan_id → plans(id, org_id)
alter table plans
  add constraint plans_parent_org_fk
    foreign key (parent_plan_id, org_id)
    references plans(id, org_id) on delete set null;

-- plan_stops → plans(id, org_id)
alter table plan_stops
  add constraint plan_stops_plan_org_fk
    foreign key (plan_id, org_id)
    references plans(id, org_id) on delete cascade;

-- plan_stops → vehicles(id, org_id)
alter table plan_stops
  add constraint plan_stops_vehicle_org_fk
    foreign key (vehicle_id, org_id)
    references vehicles(id, org_id) on delete cascade;

-- plan_stops → deliveries(id, org_id)
alter table plan_stops
  add constraint plan_stops_delivery_org_fk
    foreign key (delivery_id, org_id)
    references deliveries(id, org_id) on delete cascade;

-- simulation_events.plan_id → plans(id) — simple FK (no org_id composite needed
-- because simulation_events already has its own org_id column with RLS)
alter table simulation_events
  add constraint simulation_events_plan_id_fkey
    foreign key (plan_id)
    references plans(id) on delete set null;

-- audit_logs.plan_id → plans(id)
alter table audit_logs
  add constraint audit_logs_plan_id_fkey
    foreign key (plan_id)
    references plans(id) on delete set null;

-- audit_logs.disruption_id → disruptions(id)
alter table audit_logs
  add constraint audit_logs_disruption_id_fkey
    foreign key (disruption_id)
    references disruptions(id) on delete set null;

-- disruptions.confirmed_by and disruptions_confirmed_by_org_fk are unchanged
-- (confirmed_by references profiles.id which stays uuid).

-- -----------------------------------------------------------------------------
-- STEP 6: Replace RPC functions with text ID signatures
-- -----------------------------------------------------------------------------

-- Drop old signature first; the parameter list is part of the function identity in
-- PostgreSQL, so we must drop by exact old signature before creating the new one.
drop function if exists confirm_disruption_tx(uuid, text, text, jsonb, int);

create or replace function confirm_disruption_tx(
  p_disruption_id text,
  p_raw_text      text,
  p_type          text,
  p_payload       jsonb,
  p_at_min        int
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid  uuid        := auth.uid();
  v_caller_org  uuid        := auth_org();
  v_caller_role user_role   := auth_role();
  v_disruption  disruptions%rowtype;
  v_audit_id    uuid;
begin
  if v_caller_uid is null or v_caller_org is null then
    raise exception 'unauthenticated';
  end if;

  if v_caller_role not in ('admin', 'dispatcher') then
    raise exception 'insufficient permissions: viewers cannot confirm disruptions';
  end if;

  if p_disruption_id is not null and exists (
    select 1 from disruptions where id = p_disruption_id
  ) then
    -- Update existing disruption record
    update disruptions
    set confirmed_by = v_caller_uid,
        confirmed_at = now(),
        payload      = p_payload,
        at_min       = p_at_min,
        raw_text     = coalesce(p_raw_text, raw_text)
    where id = p_disruption_id and org_id = v_caller_org
    returning * into v_disruption;

    if not found then
      raise exception 'disruption not found or organization mismatch';
    end if;
  else
    -- Insert new disruption record; generate a text ID when none supplied
    insert into disruptions (
      id, org_id, type, payload, raw_text, confirmed_by, at_min, confirmed_at
    ) values (
      coalesce(p_disruption_id, gen_random_uuid()::text),
      v_caller_org,
      p_type,
      p_payload,
      p_raw_text,
      v_caller_uid,
      p_at_min,
      now()
    ) returning * into v_disruption;
  end if;

  -- Append audit history atomically
  insert into audit_logs (
    org_id, actor_id, action, entity_type, entity_id, disruption_id, payload
  ) values (
    v_caller_org,
    v_caller_uid,
    'disruption_confirmed',
    'disruption',
    v_disruption.id,    -- text after migration
    v_disruption.id,    -- text after migration
    jsonb_build_object(
      'type',     v_disruption.type,
      'at_min',   v_disruption.at_min,
      'raw_text', v_disruption.raw_text,
      'payload',  v_disruption.payload
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'disruption_id', v_disruption.id,
    'audit_id',      v_audit_id,
    'confirmed_by',  v_caller_uid,
    'confirmed_at',  v_disruption.confirmed_at
  );
end;
$$;

-- Drop old record_audit_log signature (uuid params) then recreate with text.
-- Note: record_audit_log is not called via .rpc() in the current application;
-- direct inserts to audit_logs use .insert() in persistenceService.createAuditLog.
-- The function is retained for completeness and potential future RPC usage.
drop function if exists record_audit_log(text, text, uuid, uuid, uuid, jsonb);

create or replace function record_audit_log(
  p_action        text,
  p_entity_type   text,
  p_entity_id     text    default null,
  p_plan_id       text    default null,
  p_disruption_id text    default null,
  p_payload       jsonb   default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid  uuid      := auth.uid();
  v_caller_org  uuid      := auth_org();
  v_caller_role user_role := auth_role();
  v_audit_id    uuid;
begin
  if v_caller_uid is null or v_caller_org is null then
    raise exception 'unauthenticated';
  end if;

  if v_caller_role not in ('admin', 'dispatcher') then
    raise exception 'insufficient permissions: viewers cannot record audit logs';
  end if;

  insert into audit_logs (
    org_id, actor_id, action, entity_type, entity_id,
    plan_id, disruption_id, payload
  ) values (
    v_caller_org,
    v_caller_uid,
    p_action,
    p_entity_type,
    p_entity_id,
    p_plan_id,
    p_disruption_id,
    p_payload
  ) returning id into v_audit_id;

  return v_audit_id;
end;
$$;
