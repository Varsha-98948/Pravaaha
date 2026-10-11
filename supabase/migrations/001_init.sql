create extension if not exists pgcrypto;
create type user_role as enum ('admin','dispatcher','viewer');
create table organizations (id uuid primary key default gen_random_uuid(), name text not null);
create table profiles (id uuid primary key references auth.users on delete cascade, org_id uuid not null references organizations on delete cascade, name text not null, role user_role not null default 'viewer');
create table locations (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, name text not null, kind text not null check (kind in ('depot','customer')));
create table vehicles (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, name text not null, capacity int not null check (capacity > 0), depot_id uuid not null references locations, shift_start int not null default 0, shift_end int not null, status text not null default 'active' check (status in ('active','failed')), check (shift_end > shift_start));
create table deliveries (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, location_id uuid not null references locations, size int not null check (size > 0), service_min int not null default 10 check (service_min >= 0), window_start int not null, window_end int not null, priority text not null default 'normal' check (priority in ('normal','urgent')), check (window_end > window_start));
create table plans (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, label text not null, parent_plan_id uuid references plans, created_at_min int not null default 0, created_at timestamptz default now());
create table plan_stops (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, plan_id uuid not null references plans on delete cascade, vehicle_id uuid not null references vehicles, delivery_id uuid not null references deliveries, seq int not null, arrival int not null, service_start int not null, departure int not null, status text not null default 'pending' check (status in ('pending','completed','late','skipped')), decision text check (decision in ('kept','moved','broken')), unique (plan_id, vehicle_id, seq));
create table disruptions (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, type text not null check (type in ('road_closure','vehicle_failure','urgent_delivery')), payload jsonb not null, raw_text text, confirmed_by uuid references profiles, at_min int not null);
create table simulation_events (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade, plan_id uuid references plans, kind text not null, payload jsonb, at_min int not null);
create index on profiles (org_id); create index on vehicles (org_id); create index on locations (org_id); create index on deliveries (org_id); create index on plans (org_id); create index on plan_stops (plan_id); create index on disruptions (org_id); create index on simulation_events (org_id);
create function auth_org() returns uuid language sql stable security definer set search_path = public as $$ select org_id from profiles where id = auth.uid() $$;
create function auth_role() returns user_role language sql stable security definer set search_path = public as $$ select role from profiles where id = auth.uid() $$;
-- Roles can only be changed by an admin of the same org; blocks self-promotion.
create function guard_role() returns trigger language plpgsql security definer as $$ begin if new.role is distinct from old.role and coalesce(auth_role(),'viewer') <> 'admin' then raise exception 'only admins can change roles'; end if; if new.org_id is distinct from old.org_id then raise exception 'org_id is immutable'; end if; return new; end $$;
create trigger profiles_guard before update on profiles for each row execute function guard_role();
alter table organizations enable row level security; alter table profiles enable row level security;
create policy org_read on organizations for select using (id = auth_org());
create policy profiles_read on profiles for select using (org_id = auth_org());
create policy profiles_update on profiles for update using (org_id = auth_org() and (id = auth.uid() or auth_role() = 'admin')) with check (org_id = auth_org());
do $$ declare t text; begin foreach t in array array['locations','vehicles','deliveries','plans','plan_stops','disruptions','simulation_events'] loop
  execute format('alter table %I enable row level security', t);
  execute format('create policy %I on %I for select using (org_id = auth_org())', t||'_read', t);
  execute format('create policy %I on %I for all using (org_id = auth_org() and auth_role() in (''admin'',''dispatcher'')) with check (org_id = auth_org() and auth_role() in (''admin'',''dispatcher''))', t||'_write', t);
end loop; end $$;
-- New users: create their profile as 'viewer' via an admin/invite flow (profile inserts are intentionally not allowed from clients).
