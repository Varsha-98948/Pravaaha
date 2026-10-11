-- =============================================================================
-- Migration 002: Security Hardening, Cross-Org FK Protection & Append-Only Audit History
-- =============================================================================
--
-- Security Note:
-- RLS policies and triggers are enforced in PostgreSQL.
-- In offline / local development or test suites, live Supabase RLS verification
-- requires running against a live Supabase instance with authentic JWTs.
-- =============================================================================

-- 1. Hardening existing security definer functions with safe search_path
create or replace function auth_org() returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select org_id from profiles where id = auth.uid() $$;

create or replace function auth_role() returns user_role
language sql stable security definer
set search_path = public, pg_temp
as $$ select role from profiles where id = auth.uid() $$;

-- 2. Guard against profile privilege escalation and org mutability
create or replace function guard_role() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and coalesce(auth_role(), 'viewer') <> 'admin' then
    raise exception 'only admins can change roles';
  end if;
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable';
  end if;
  return new;
end;
$$;

-- 3. Extend profiles schema with email column for UserProfile contract mapping
alter table profiles add column if not exists email text;

-- Guard profile creation to prevent unprivileged users from inserting admin/dispatcher profiles
create or replace function guard_profile_insert() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Prevent privilege escalation on creation: non-admins cannot insert admin/dispatcher profiles
  if coalesce(auth_role(), 'viewer') <> 'admin' and new.role <> 'viewer' then
    raise exception 'only admins can create elevated roles';
  end if;
  -- Ensure user belongs to caller's org if caller is authenticated with an org
  if auth_org() is not null and new.org_id <> auth_org() then
    raise exception 'cannot create profile in a foreign organization';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on profiles;
create trigger profiles_guard_insert
  before insert on profiles
  for each row execute function guard_profile_insert();

-- Allow admins to insert profiles in their organization, and users to insert their own viewer profile
create policy profiles_insert on profiles for insert
  with check (
    (auth_role() = 'admin' and org_id = auth_org())
    or (id = auth.uid() and role = 'viewer' and org_id = auth_org())
  );

-- 4. Extend plans schema for unassigned deliveries contract
alter table plans add column if not exists unassigned jsonb not null default '[]'::jsonb;

-- 5. Extend disruptions schema for confirmed timestamp
alter table disruptions add column if not exists confirmed_at timestamptz default now();

-- 6. Prevent Cross-Organization Foreign Key References
-- To prevent an entity in Org A from referencing a foreign key entity in Org B,
-- we establish composite unique constraints (id, org_id) and composite foreign keys.

alter table organizations add constraint organizations_id_key unique (id);
alter table profiles add constraint profiles_id_org_id_uniq unique (id, org_id);
alter table locations add constraint locations_id_org_id_uniq unique (id, org_id);
alter table vehicles add constraint vehicles_id_org_id_uniq unique (id, org_id);
alter table deliveries add constraint deliveries_id_org_id_uniq unique (id, org_id);
alter table plans add constraint plans_id_org_id_uniq unique (id, org_id);
alter table disruptions add constraint disruptions_id_org_id_uniq unique (id, org_id);

-- Enforce organization scoping across relations
alter table vehicles
  drop constraint if exists vehicles_depot_org_fk,
  add constraint vehicles_depot_org_fk foreign key (depot_id, org_id)
    references locations(id, org_id) on delete restrict;

alter table deliveries
  drop constraint if exists deliveries_location_org_fk,
  add constraint deliveries_location_org_fk foreign key (location_id, org_id)
    references locations(id, org_id) on delete restrict;

alter table plans
  drop constraint if exists plans_parent_org_fk,
  add constraint plans_parent_org_fk foreign key (parent_plan_id, org_id)
    references plans(id, org_id) on delete set null;

alter table plan_stops
  drop constraint if exists plan_stops_plan_org_fk,
  add constraint plan_stops_plan_org_fk foreign key (plan_id, org_id)
    references plans(id, org_id) on delete cascade;

alter table plan_stops
  drop constraint if exists plan_stops_vehicle_org_fk,
  add constraint plan_stops_vehicle_org_fk foreign key (vehicle_id, org_id)
    references vehicles(id, org_id) on delete cascade;

alter table plan_stops
  drop constraint if exists plan_stops_delivery_org_fk,
  add constraint plan_stops_delivery_org_fk foreign key (delivery_id, org_id)
    references deliveries(id, org_id) on delete cascade;

alter table disruptions
  drop constraint if exists disruptions_confirmed_by_org_fk,
  add constraint disruptions_confirmed_by_org_fk foreign key (confirmed_by, org_id)
    references profiles(id, org_id) on delete set null;

-- 7. Dedicated Append-Only Audit History Table
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  actor_id uuid not null references profiles on delete cascade,
  action text not null check (action in ('disruption_confirmed', 'plan_created', 'plan_updated', 'role_changed', 'vehicle_status_changed', 'manual_override')),
  entity_type text not null check (entity_type in ('disruption', 'plan', 'profile', 'vehicle', 'delivery', 'system')),
  entity_id uuid,
  plan_id uuid references plans on delete set null,
  disruption_id uuid references disruptions on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_id_idx on audit_logs (org_id);
create index if not exists audit_logs_actor_id_idx on audit_logs (actor_id);
create index if not exists audit_logs_created_at_idx on audit_logs (org_id, created_at desc);
create index if not exists audit_logs_plan_id_idx on audit_logs (plan_id);
create index if not exists audit_logs_disruption_id_idx on audit_logs (disruption_id);

alter table audit_logs enable row level security;

-- Read policy: users can only read audit logs within their organization
create policy audit_logs_read on audit_logs for select
  using (org_id = auth_org());

-- Insert policy: only authorized users within the organization can insert audit records;
-- actor_id must match the authenticated user to prevent forging actor identity.
create policy audit_logs_insert on audit_logs for insert
  with check (
    org_id = auth_org()
    and actor_id = auth.uid()
    and auth_role() in ('admin', 'dispatcher')
  );

-- Immutability enforcement: audit entries are strictly append-only
create or replace function guard_audit_logs_immutability() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit logs are immutable and cannot be updated or deleted';
end;
$$;

drop trigger if exists audit_logs_guard_mutation on audit_logs;
create trigger audit_logs_guard_mutation
  before update or delete on audit_logs
  for each row execute function guard_audit_logs_immutability();

-- 8. Transactional Disruption Confirmation & Audit Stored Procedure
create or replace function confirm_disruption_tx(
  p_disruption_id uuid,
  p_raw_text text,
  p_type text,
  p_payload jsonb,
  p_at_min int
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_caller_org uuid := auth_org();
  v_caller_role user_role := auth_role();
  v_disruption disruptions%rowtype;
  v_audit_id uuid;
begin
  if v_caller_uid is null or v_caller_org is null then
    raise exception 'unauthenticated';
  end if;

  if v_caller_role not in ('admin', 'dispatcher') then
    raise exception 'insufficient permissions: viewers cannot confirm disruptions';
  end if;

  if p_disruption_id is not null and exists (select 1 from disruptions where id = p_disruption_id) then
    update disruptions
    set confirmed_by = v_caller_uid,
        confirmed_at = now(),
        payload = p_payload,
        at_min = p_at_min,
        raw_text = coalesce(p_raw_text, raw_text)
    where id = p_disruption_id and org_id = v_caller_org
    returning * into v_disruption;

    if not found then
      raise exception 'disruption not found or organization mismatch';
    end if;
  else
    insert into disruptions (
      id, org_id, type, payload, raw_text, confirmed_by, at_min, confirmed_at
    ) values (
      coalesce(p_disruption_id, gen_random_uuid()),
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
    v_disruption.id,
    v_disruption.id,
    jsonb_build_object(
      'type', v_disruption.type,
      'at_min', v_disruption.at_min,
      'raw_text', v_disruption.raw_text,
      'payload', v_disruption.payload
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'disruption_id', v_disruption.id,
    'audit_id', v_audit_id,
    'confirmed_by', v_caller_uid,
    'confirmed_at', v_disruption.confirmed_at
  );
end;
$$;

-- 9. Transactional Audit Log Stored Procedure
create or replace function record_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_plan_id uuid default null,
  p_disruption_id uuid default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_caller_org uuid := auth_org();
  v_caller_role user_role := auth_role();
  v_audit_id uuid;
begin
  if v_caller_uid is null or v_caller_org is null then
    raise exception 'unauthenticated';
  end if;

  if v_caller_role not in ('admin', 'dispatcher') then
    raise exception 'insufficient permissions: viewers cannot record audit logs';
  end if;

  insert into audit_logs (
    org_id, actor_id, action, entity_type, entity_id, plan_id, disruption_id, payload
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
