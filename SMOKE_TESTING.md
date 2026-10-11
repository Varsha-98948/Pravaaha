# Pravaaha A-to-Z Manual Smoke Testing

## 1. Purpose and scope

Use this procedure to exercise the current React/Vite application against either its explicit demo mode or a dedicated Supabase test project. It covers authentication and profile loading, role-gated navigation, organization-scoped reads, location/vehicle/delivery creation, persisted plan display and comparison, disruption preview/confirmation/replanning, and user-role changes.

This procedure does not prove that PostgreSQL RLS is correct merely because a page loads, that a Vite unit test exercised PostgreSQL, that an AI provider is reachable, or that a production hosting service provides the Vite server middleware. Run live checks against a dedicated test project with real authenticated accounts. SQL catalog queries below inspect policy and schema definitions; they do not replace requests made with the app's authenticated user token.

## 2. Prerequisites

### Local tools and commands

- Node.js/npm compatible with the repository's lockfile.
- A browser with its developer tools.
- A dedicated non-production Supabase project for live tests. Keep production and shared organizational data out of this procedure.
- The Supabase dashboard or another already-authorized, read-only SQL connection for post-test inspection.
- `package-lock.json` is present. Install dependencies with `npm ci`.

Repository scripts:

```sh
npm ci
npm test
npm run build
npm run dev
npm run preview
```

`npm run dev` starts Vite, which installs the repository's AI HTTP middleware. `npm run preview` serves the built app. The current config declares a `configurePreview` plugin property, while the installed Vite API exposes `configurePreviewServer`; therefore do not assume the AI middleware is installed under `vite preview` without checking `GET /api/ai-status`. A separately hosted static production build does not automatically run this Node middleware; deployment must provide the same same-origin API endpoints or AI interpretation will fail.

### Supabase configuration and migrations

The client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. If either is absent, the app enters demo mode. The repository has no `.env.example`, no Supabase CLI script, and no `supabase/config.toml`; do not infer project identity from the presence of an environment file. Configure the URL and public anon/publishable key for the dedicated test project in an ignored local `.env` file, and restart Vite after changing it. Never use a service-role key in the browser or paste any key into screenshots, logs, or this document.

The SQL source is `supabase/migrations/001_init.sql`, `002_security_and_audit.sql`, then `003_operational_text_ids.sql`. Verify the intended test project's migration history and resulting schema before testing. Migration 001 and 002 contain non-idempotent `CREATE TYPE`, table, constraint, and policy statements; do not rerun them blindly. Migration 003 expects the schema from 001 and 002 and is not a partial-repair script. Use the Supabase migration history/dashboard or the project's existing approved migration process; this repository does not define a migration-apply command.

The code and migration source establish these important schema contracts:

- Roles are `admin`, `dispatcher`, and `viewer`.
- `profiles.id` is the Supabase Auth user UUID; `profiles.org_id` is the organization UUID. Operational entity IDs are text after migration 003; organization/profile/auth IDs remain UUID.
- Core tables are `organizations`, `profiles`, `locations`, `vehicles`, `deliveries`, `plans`, `plan_stops`, `disruptions`, `simulation_events`, and `audit_logs`.
- `locations.kind` is `depot` or `customer`; vehicles refer to `locations` through `depot_id`; deliveries refer through `location_id`.
- Plans store `unassigned` JSON and stops in `plan_stops`. There is no standalone travel-time matrix table.
- Migrations enable RLS and define organization policies. Migrations 001/002/003 also define authorization/immutability triggers and RPCs including `confirm_disruption_tx` and `record_audit_log`.

### AI provider configuration

The Vite server-side provider recognizes `AI_PROVIDER` (`gemini`, `openai`, `groq`, or `anthropic`), `AI_API_KEY` and provider-specific keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`), `AI_MODEL` and provider-specific model variables (`GEMINI_MODEL`, `OPENAI_MODEL`, `GROQ_MODEL`, `ANTHROPIC_MODEL`), optional `AI_API_ENDPOINT`, and `AI_TIMEOUT_MS`. Do not put any of these secrets in `VITE_` variables. Provider-specific defaults and compatibility vary; use an account and model authorized for your test environment.

The live page sends same-origin requests to `GET /api/ai-status` and `POST /api/interpret-disruption`. The repository also contains `supabase/functions/interpret-disruption/index.ts`, but the current browser service does not invoke it directly. Its deployment/configuration is separate and must not be assumed from the Vite path.

## 3. Test accounts and permissions

Use existing, authorized accounts already linked to profiles in the dedicated test organization whenever possible. The app supports password sign-in only; it has no signup, password-reset, invitation, or account-creation UI. The Users page lists existing profiles and allows an admin to change a profile's role; it cannot create an Auth user or profile.

For new test identities, have the project/organization administrator create or invite the Auth identities through the approved Supabase Auth process and link each Auth UUID to a valid profile in the test organization using the organization's approved, trigger-compatible provisioning path. Confirm the profile before signing in. Do not assume that creating an Auth identity creates its profile. The database trigger `guard_profile_insert()` and role guard remain enabled; the SQL Editor's elevated database connection is not proof that `auth.uid()` or `auth_role()` will represent an admin. If no authorized admin/provisioning path exists, stop account setup and ask the project owner to establish one safely; do not disable RLS/triggers or use a browser service-role key.

Expected distinctions in the app:

| Role | Navigation and writes |
| --- | --- |
| `admin` | All seven navigation entries, including Disruptions and Users. May create locations, vehicles, and deliveries; confirm disruptions/replans; and change existing profile roles. |
| `dispatcher` | Overview, Fleet, Deliveries, Route plan, Disruptions, and Compare plans. Operational writes are allowed. Users is not in navigation and role administration is prohibited. |
| `viewer` | Overview, Fleet, Deliveries, Route plan, and Compare plans. Read-only; Disruptions and Users are not in navigation. |

Navigation is a UI aid. Services check roles and organization IDs, and PostgreSQL RLS/triggers/RPC checks are authoritative. A hidden button alone is not a security test.

## 4. Preflight checks

1. From the repository root, run `git status --short`. Use a clean working tree or record and preserve any pre-existing changes. Do not reset, clean, or discard user changes.
2. Run `npm ci`, `npm test`, and `npm run build`. Resolve failures before treating a manual result as an application regression. Tests cover engine, service contracts, validation, migration text invariants, and AI provider behavior; they do not connect to the intended Supabase project.
3. Check only whether the required variables are configured; do not print their values. `VITE_SUPABASE_URL` must identify the dedicated test project and `VITE_SUPABASE_ANON_KEY` must be its public client key. Restart `npm run dev` after editing the ignored `.env`.
4. Verify in the Supabase dashboard that the project ref/URL is the test project, that migrations 001–003 are applied in order, and that Auth test accounts have profile rows. Do not run migrations as part of this smoke procedure.
5. Sign in with an authorized test account and load Overview, Fleet, and Deliveries. A successful page read tests the app's authenticated client path. The `checkSupabaseConnectivity()` helper is read-only but is not exposed as a page in the current app.
6. Open browser developer tools. Preserve console and Network logs for failures. Never export HAR files or screenshots containing Authorization headers, cookies, keys, or personal data.

## 5. Test data preparation

Use a disposable test organization with no shared operational records. If using an existing test organization, obtain its owner's permission, record the exact organization UUID, and create clearly named test locations such as `SMOKE-2026-10-11 Depot` and `SMOKE-2026-10-11 Customer A`. Use one unique run prefix per test run.

The organization and its first admin profile are not created in the app. Prepare them through the project's authorized provisioning procedure. The app's minimum record workflow is:

1. Create one **depot** and at least two **customer** locations in Fleet.
2. Create one active vehicle with that depot, positive capacity, shift start, and a later shift end.
3. Create two or more deliveries against customer locations. Use positive integer sizes, nonnegative integer service minutes, a start at or after zero, and a window end greater than the start. At least one delivery can be urgent.
4. For saved-plan, disruption, and comparison tests, a baseline saved plan must already exist in the test organization, and it must have persisted stops whose arrival/departure times permit the app to reconstruct one or more directed route legs. The current UI has no initial plan-generation or plan-save control. A trusted test-data setup or an already seeded test plan is therefore required; do not invent a button or assume that creating deliveries generates a plan.
5. For comparison after the disruption test, there must be two saved plans. A successful confirmed disruption can produce a revised plan when the baseline and data meet the requirements below.

Locations, vehicles, and deliveries can be created in Fleet/Deliveries by admin or dispatcher. The UI has no edit or delete controls for these records. Protect any vehicle used in the failure test: the current UI sets its status to `failed` and has no restore-to-active control.

## 6. A-to-Z end-to-end test sequence

For each test, record the run prefix, test organization UUID, account role, timestamp, visible result, and database result. Do not use production data.

### ST-01 — Demo mode and sample-data boundary

- **Role:** None.
- **Preconditions:** Use a local run without one or both Supabase client variables.
- **Actions:** Run `npm run dev`, open the displayed local URL, choose **Enter demo**, and view Overview, Fleet, Deliveries, Route plan, Compare plans, and Disruptions. In the sidebar, switch the demo role among admin, dispatcher, and viewer.
- **Expected:** Login states that Supabase is not configured and demo uses sample data. Sample records are visible. Fleet/Deliveries are read-only in demo mode; role-based navigation changes with the selector. Disruptions offers demo quick scenarios and updates only in-memory demo state. It does not persist to Supabase. AI interpretation is not available in demo mode.
- **Persisted result:** None. A refresh/reload returns to demo entry/sample state.
- **Cleanup:** None.

### ST-02 — Live sign-in, session restoration, and sign-out

- **Role:** Run once for each of admin, dispatcher, viewer.
- **Preconditions:** Test project configured; each Auth user has a valid profile.
- **Actions:** Sign in on the ReRoute login screen with the test account. Confirm the page waits while checking Supabase session/profile. Refresh the browser and confirm session restoration. Use **Sign out**, then sign in again.
- **Expected:** Valid credentials load the app and the profile role/name. Invalid credentials show an error and do not open the app. Refresh restores an active session/profile. Sign out returns to Login. If Auth succeeds but the profile is missing/inaccessible, a **Profile Unavailable** state appears and offers sign out; the app must not switch to sample data.
- **Persisted result:** No operational database writes.
- **Cleanup:** Sign out.

### ST-03 — Role navigation and read-only controls

- **Role:** Admin, dispatcher, viewer.
- **Preconditions:** ST-02 passed for all accounts.
- **Actions:** Inspect the sidebar for each account. Open Fleet and Deliveries. Inspect create forms. Attempt to open Users or Disruptions by navigation where available.
- **Expected:** Admin sees Overview, Fleet, Deliveries, Route plan, Disruptions, Compare plans, Users. Dispatcher sees the same except Users. Viewer sees Overview, Fleet, Deliveries, Route plan, Compare plans only. Only admin/dispatcher see Fleet/Delivery write forms; viewer sees read-only data. Do not treat this check as backend authorization proof.
- **Known UI issue:** In live mode, App currently displays a banner saying Disruptions/Users “still shows sample data” because its banner allowlist omits those page IDs. This conflicts with their live Supabase page implementations. Record the banner as a stale warning; verify the actual page query results and do not infer data mode from that banner.
- **Cleanup:** None.

### ST-04 — Empty organization, loading, refresh, and query error states

- **Role:** Viewer or dispatcher.
- **Preconditions:** A dedicated, valid test account/org. For the empty case, use a separate organization with no operational records, if available.
- **Actions:** Load Overview, Fleet, Deliveries, Route plan, Compare plans, and Disruptions. Observe loading states, wait for queries to finish, press each page's **Refresh**, and record results. In a controlled test browser only, use DevTools Network **Offline** and press Refresh, then restore network.
- **Expected:** Loading is shown during fetch. Empty lists/plans display empty-state text, not demo records. Compare reports that at least two saved plans are needed. A query/network failure shows an error and never silently substitutes demo data. Refresh retries the live query.
- **Persisted result:** None.
- **Cleanup:** Restore online state and reload.

### ST-05 — Create organization locations

- **Role:** Admin, then dispatcher.
- **Preconditions:** Live authenticated account, test org, Fleet queries successful, unique run prefix.
- **Actions:** In **Fleet**, use **Create location**. Enter a unique name, select **Depot**, submit. Repeat with two unique names and **Customer**. Press **Refresh**.
- **Expected:** Saving state appears; after database confirmation, success is shown and all locations appear with the selected kind. Each record is scoped to the logged-in organization. Empty name is rejected by required validation. The app has no location edit/delete form.
- **Persisted result:** `public.locations` rows with `org_id`, `name`, `kind` and generated text-compatible ID.
- **Cleanup:** Keep until tests finish; cleanup details are in section 11.

### ST-06 — Create a vehicle and validate depot relationship

- **Role:** Admin, then dispatcher.
- **Preconditions:** ST-05 depot exists; no cross-organization location should be used.
- **Actions:** In Fleet, use **Create vehicle**. Enter a unique vehicle name; choose the test depot; enter positive integer **Capacity**, integer **Shift starts (minutes)**, and a greater **Shift ends (minutes)**; click **Create vehicle**. Press **Refresh**.
- **Expected:** Saved vehicle appears with capacity, depot name, shift range, and `active` status. With no depot, the create control is disabled and the page says to create a depot first. Invalid capacity or shift range is rejected. No edit/delete form is present.
- **Persisted result:** `public.vehicles` row; `depot_id` refers to a depot location in the same organization. The composite FK/RLS must reject cross-org references.
- **Cleanup:** Keep a separate active vehicle for normal tests and a dedicated vehicle for failure testing.

### ST-07 — Create deliveries and validate fields

- **Role:** Admin, then dispatcher.
- **Preconditions:** At least one test customer location exists.
- **Actions:** In **Deliveries**, submit **Create delivery** with a customer, positive integer size, nonnegative integer service minutes, valid start/end minute window, and priority **Normal**. Create another with **Urgent**. Press **Refresh**.
- **Expected:** Success appears only after save and query refresh; the rows and count cards show the records and priority. If no customer exists, the form is disabled with a message to create a customer in Fleet first. Zero/negative/noninteger size, negative service minutes, or end time not greater than start is rejected by the form/service/database. There is no edit/delete UI.
- **Persisted result:** `public.deliveries` rows with `location_id`, size, service/window fields, priority, and the test `org_id`.
- **Cleanup:** Keep for plan/disruption checks.

### ST-08 — Dashboard live metrics and spatial plan panel

- **Role:** Viewer, dispatcher, or admin.
- **Preconditions:** ST-05–07 records; to see plan-derived metrics and canvas, a persisted plan is required.
- **Actions:** Open **Overview** and press **Refresh**. Record Active vehicles, Deliveries, Scheduled, Unassigned, and Late stops. If a latest plan exists, inspect **Latest persisted route plan**.
- **Expected:** Active vehicles and delivery count match successfully loaded org data. Plan-derived metrics are shown as unavailable when no saved plan exists; they are not fabricated. With a plan, canvas and plan metrics reflect the latest saved plan. No-data, loading, and query errors remain visible.
- **Persisted result:** Read-only; no writes.
- **Cleanup:** None.

### ST-09 — Saved route plan and spatial visualization

- **Role:** Viewer, dispatcher, or admin.
- **Preconditions:** At least one persisted plan with stop rows, matching test vehicles/deliveries/locations in the same org.
- **Actions:** Open **Route plan**. Use the canvas vehicle chips to select each vehicle and **Tactical 2D / Spatial 3D** to change view. Click a location waypoint. Inspect the route cards and stop timeline. Press **Refresh**.
- **Expected:** The latest saved plan is loaded, with its label, routes, stop order/times, loads, and unassigned count. Vehicle filtering changes visible routes; 2D/3D controls switch the canvas projection; selecting a waypoint shows the inspection panel. Empty/no-plan and query error states are explicit.
- **Important limitation:** The canvas uses a “Simulated Coordinate Frame” and deterministic positions; migrations contain no latitude/longitude. It is a route visualization, not a geographic map or measured-distance display. The UI does not generate the initial plan.
- **Persisted result:** Read-only.
- **Cleanup:** None.

### ST-10 — AI interpretation preview (optional provider-dependent)

- **Role:** Admin or dispatcher.
- **Preconditions:** Live mode; test locations/vehicles; Vite dev middleware running; authorized AI provider configured in the server environment. For preview/deployed testing, first verify the same-origin API is actually installed. Do not paste secrets into browser settings.
- **Actions:** In a second browser tab (or DevTools Network), request `GET /api/ai-status`. Confirm only `configured`, provider/model names, and missing configuration are returned; no key is returned. On **Disruptions**, enter an incident describing a known test vehicle/location and a valid simulation minute. Click **Interpret with AI**.
- **Expected:** A preview with source and supported event summary appears; no database mutation occurs before **Confirm and replan**. Unknown organization IDs must not be accepted. For unsupported/ambiguous text, no valid event should be confirmable and an error/missing-field explanation should appear. Current page does not render `needsClarification` or `clarificationQuestion` as dedicated fields; record this limitation if the provider returns them.
- **Failure test:** Without provider config or with the provider endpoint unavailable, interpretation reports an error/missing config and writes no disruption. Do not interpret a failed AI request as a successful event.
- **Persisted result:** None until the explicit confirmation step.
- **Cleanup:** None.

### ST-11 — Structured disruption validation

- **Role:** Admin or dispatcher.
- **Preconditions:** A saved baseline plan and at least one persisted route leg are needed for confirmation/replanning. The latest plan's created simulation minute is shown by the page's state/plan data.
- **Actions:** In **Disruptions**, choose a **Disruption type**, enter **Effective time (simulation minutes)**, and choose required org records. For a vehicle failure choose **Vehicle**; for road closure choose distinct **From location** and **To location**; for urgent delivery choose customer **Delivery location**, size, service minutes, and time-window bounds. Enter a short description and click **Prepare structured event**.
- **Expected:** A pending preview is shown only for a valid, known event; this button uses the structured fields and does not parse the description. Empty description, missing selection, negative/non-integer/invalid time values, same endpoints, unknown IDs, or invalid urgent delivery fields are rejected. Confirm is not a substitute for correcting invalid input.
- **Persisted result:** None during preparation.
- **Cleanup:** Reject the preview if not continuing.

### ST-12 — Confirm disruption, audit, replanning, and persistence

- **Role:** Admin or dispatcher.
- **Preconditions:** Dedicated test org; usable latest saved baseline plan with route stops/leg times; event time not earlier than plan simulation time. For road closure, the selected link must exist in the matrix reconstructed from that saved plan (at least one direction). Keep a separate active vehicle for ordinary checks.
- **Actions:** Prepare a valid vehicle failure or road closure using ST-11. Review event type/time/IDs. Click **Confirm and replan** once. Wait for the saving state to finish, then inspect **Persisted Disruptions**, **Active Plan**, Route plan, Compare plans, and Dashboard after Refresh.
- **Expected:** Success is shown only after disruption confirmation and revised plan save succeed. A vehicle failure changes the chosen vehicle to `failed`; replanning preserves completed work and reassigns remaining feasible deliveries or lists them unassigned. A road closure affects the route engine when the leg exists. A new saved plan is associated with the prior plan. Compare becomes available once there are two saved plans.
- **Persisted result:** `disruptions` row; `audit_logs` `disruption_confirmed` entry from the RPC; for vehicle failure, `vehicles.status='failed'`; new `plans` row and matching `plan_stops` rows; plan audit may be written by the client. Audit writes for plan/status are non-blocking in current service code, so the UI success alone does not prove every audit insert succeeded. Verify with read-only SQL below.
- **Partial failure caveat:** This workflow is several sequential requests, not one application-level transaction. Urgent delivery is saved before disruption RPC; vehicle status follows disruption RPC; plan header/stops follow those. A later failure can leave earlier writes committed and the page reports partial progress. Use a dedicated disposable project for controlled failures; never revoke policies or induce errors in a shared/production database.
- **Cleanup:** Preserve records until SQL verification. A failure-test vehicle remains failed; there is no restore-status UI.

### ST-13 — Urgent delivery handling

- **Role:** Admin or dispatcher.
- **Preconditions:** Same baseline-plan/route-leg requirements as ST-12 and a test customer location.
- **Actions:** Prepare an urgent delivery with size, service time, and valid window. Confirm once. Refresh Deliveries, Disruptions, Routes, Compare, and Overview.
- **Expected:** The urgent delivery is inserted before plan-stop persistence, appears in Deliveries with `urgent` priority, the disruption appears in the disruption list, and the revised plan assigns it if feasible or shows it as unassigned with a reason. Failure after the delivery save is reported as a partial write; do not retry blindly until checking whether the delivery exists.
- **Persisted result:** `deliveries`, `disruptions`, `audit_logs`, `plans`, and possibly `plan_stops`, all scoped to the test organization.
- **Cleanup:** Keep for SQL verification.

### ST-14 — Compare saved plans and unassigned deliveries

- **Role:** Viewer, dispatcher, or admin.
- **Preconditions:** At least two saved plans in the organization.
- **Actions:** Open **Compare plans** and press **Refresh**. Compare the displayed prior/latest labels, decision counts (`kept`, `moved`, `broken`), and each delivery's original/revised assignment or unassigned reason.
- **Expected:** The page compares the two newest saved plans using their actual persisted stops/metrics. It includes delivery IDs in saved stops/unassigned lists and current org deliveries. With fewer than two plans, it says two saved plans are required. Query failure is an error, never sample-plan fallback.
- **Persisted result:** Read-only.
- **Cleanup:** None.

### ST-15 — User/profile listing and role changes

- **Role:** Admin for write; dispatcher/viewer for access denial.
- **Preconditions:** At least two test profiles in the same test org; role changes can affect current sessions/navigation.
- **Actions:** As admin, open **Users**, inspect the profile counts and rows, change a test profile's role with its **Role for [name]** selector, click **Save role**, then **Refresh**. Sign in as that profile and verify navigation. As dispatcher/viewer, attempt the Users page by the normal UI; if a controlled test route is available, also verify the service rejects role changes.
- **Expected:** Admin sees org profiles and can change existing roles only. Success follows the database update. Dispatcher/viewer do not get Users navigation and cannot administer roles. The page does not create Auth accounts or profiles. Profile organization IDs are immutable in the database trigger.
- **Persisted result:** `profiles.role` changes for the target profile in that organization. The current page performs a profile update; do not expect a role-change audit entry solely from this UI path.
- **Cleanup:** Restore the test profile's original role as admin and sign out/in for updated navigation state.

### ST-16 — Cross-organization isolation (controlled test)

- **Role:** Accounts from two test organizations.
- **Preconditions:** Two dedicated organizations with distinctly named records and test users; never use shared or production organizations.
- **Actions:** Sign in to Org A and record its Fleet, Delivery, Route, and Users-visible values. Sign out, sign in to Org B, and repeat. Compare results. If QA has an approved authenticated-client harness, request one known Org A row by ID as Org B; do not edit JWT claims or use service credentials.
- **Expected:** Each session only sees its own organization's profiles and operational records. The harness attempt must be denied or return no row. Composite FKs prevent an org's vehicle/delivery/stop from referencing another org's entity. Catalog policy SQL below is supporting evidence only; an SQL Editor superuser query does not simulate this test.
- **Persisted result:** None.
- **Cleanup:** None.

## 7. Required feature coverage and implementation limits

| Feature | What can be smoke-tested now | Not implemented or limitation |
| --- | --- | --- |
| Login/session | Supabase password login, session restore, profile query, sign-out, profile failure | Signup, password reset, and invite UI are absent. |
| Dashboard | Live org vehicles/deliveries/latest plan, metric cards, refresh/error/empty | Plan-derived metrics are unavailable without a saved plan. |
| Locations/Fleet | Create location and vehicle, refresh, form validation | No edit/delete UI; vehicle requires an existing depot. |
| Deliveries | Create a delivery, refresh, validation, priority display | No edit/delete UI; customer location required. |
| Plan generation | Read latest plan and stop rows; show canvas | No UI to generate/save the initial plan. Plans are saved through disruption replanning in the current UI. |
| Spatial canvas | Vehicle selection, waypoint inspection, 2D/3D view | Positions are deterministic simulated coordinates, not geography. |
| Compare | Compare two latest persisted plans, assigned/unassigned decisions | No selector for arbitrary historical plans; needs two plans. |
| Disruptions | Structured preview, optional AI preview, explicit confirmation, saved replanning when data permits | Live replanning requires a saved route-leg matrix inferred from plan stops. No matrix table. No UI to restore a failed vehicle. AI clarification fields are not displayed as a dedicated question. |
| Users | List organization profiles; admin updates an existing profile role | No account/profile creation UI. Role-change audit is not guaranteed by this page path. |
| Audit | DB records from `confirm_disruption_tx`; inspect audit table | Some client audit writes are intentionally non-blocking; their success must be checked separately. |

## 8. Negative and permission tests

Perform these only in a dedicated test project:

1. **Viewer writes:** Attempt to submit a location, vehicle, or delivery using a viewer account if an approved test harness can invoke the service; UI write forms should not be offered. Confirm direct authenticated write is rejected by service authorization and RLS. Attempting to open Disruptions/Users via the normal navigation should not be possible.
2. **Dispatcher user administration:** Confirm Users is absent. An approved service test should reject `updateUserProfile` for dispatcher. Do not test by bypassing the UI with a service-role key.
3. **Invalid values:** Test blank location/vehicle names, missing depot, zero/negative/noninteger vehicle capacity, shift end <= start, missing/non-customer delivery location, size <= 0, service minutes < 0, negative window start, or window end <= start. Expect validation error and no new row.
4. **Invalid disruption references/timing:** Use unknown vehicle/location IDs, identical road endpoints, invalid numeric fields, time earlier than the plan time, or an unrecorded road leg. Expect an error/disabled or blocked confirmation; verify no disruption/plan write for pre-persistence validation errors.
5. **Provider/network failures:** Use DevTools Offline before a read refresh; restore network after verifying visible errors. For AI, remove provider configuration only in the local test-server environment or use a deliberately unavailable test endpoint, and verify no disruption row is created before explicit confirmation.
6. **Duplicate submission:** Click a create/confirm control once, then observe that it enters a disabled saving state. The UI does not provide an idempotency key; simultaneous retried requests may create separate records because IDs are generated for each attempt. Do not repeatedly click or assume exactly-once behavior. Check database before retrying after a timeout.
7. **Partial plan writes:** Only perform in an isolated disposable project with a planned restoration path. `saveDeliveryPlan` upserts the plan header, then handles stop deletion/insertion, then attempts a non-blocking audit write; the workflow is not transaction-wrapped at the page level. Disruption confirmation/urgent delivery/vehicle status are also sequential operations. Do not manufacture failures by weakening RLS or changing production policies.
8. **Cross-org FK/RLS:** Use two isolated orgs and authenticated test users. Do not create cross-org rows manually or change JWT claims. Verify policy definitions and composite FK definitions with the read-only SQL below; validate effective policies through authenticated app requests.

## 9. Supabase verification (read-only SQL)

Run only in the intended test project. Substitute the actual test organization UUID and test entity IDs. These queries do not change data. The SQL Editor may run with elevated privileges and can bypass RLS; catalog results are not an effective-RLS test.

### Confirm tables and schema version evidence

```sql
select schemaname, tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'organizations', 'profiles', 'locations', 'vehicles', 'deliveries',
    'plans', 'plan_stops', 'disruptions', 'simulation_events', 'audit_logs'
  )
order by tablename;

select n.nspname as schema_name, c.relname as migration_history_table
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and c.relname in ('schema_migrations', 'migrations')
order by n.nspname, c.relname;
```

Supabase-managed migration history can be checked in the project dashboard/CLI tooling. The repository itself does not define a history query or apply command. Do not infer all migrations applied just because tables exist.

### Inspect constraints, RLS policies, triggers, and indexes

```sql
select c.conrelid::regclass as table_name,
       c.conname as constraint_name,
       c.contype as constraint_type,
       pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.connamespace = 'public'::regnamespace
  and c.conrelid::regclass::text in (
    'public.profiles', 'public.locations', 'public.vehicles', 'public.deliveries',
    'public.plans', 'public.plan_stops', 'public.disruptions',
    'public.simulation_events', 'public.audit_logs'
  )
order by table_name, constraint_name;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'organizations', 'profiles', 'locations', 'vehicles', 'deliveries',
    'plans', 'plan_stops', 'disruptions', 'simulation_events', 'audit_logs'
  )
order by tablename, policyname;

select t.tgrelid::regclass as table_name,
       t.tgname as trigger_name,
       pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
where not t.tgisinternal
  and t.tgrelid::regclass::text in (
    'public.profiles', 'public.audit_logs'
  )
order by table_name, trigger_name;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'locations', 'vehicles', 'deliveries', 'plans',
    'plan_stops', 'disruptions', 'simulation_events', 'audit_logs'
  )
order by tablename, indexname;
```

After migration 003, verify composite constraints such as `vehicles_depot_org_fk`, `deliveries_location_org_fk`, `plans_parent_org_fk`, the three `plan_stops_*_org_fk` constraints, and `disruptions_confirmed_by_org_fk`. Also inspect the simple plan references on `simulation_events` and `audit_logs`. The exact deployed definitions are authoritative. Migration 003's final `plans_parent_org_fk` uses composite `ON DELETE SET NULL` without a column list even though `org_id` is `NOT NULL`; do not smoke-test deleting a parent plan. Treat that deletion behavior as an unresolved migration/live-schema concern and ask the database owner to review it before any such delete test.

### Inspect column types and RPC signatures/grants

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'organizations', 'profiles', 'locations', 'vehicles', 'deliveries',
    'plans', 'plan_stops', 'disruptions', 'simulation_events', 'audit_logs'
  )
order by table_name, ordinal_position;

select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(r.rolname, 'PUBLIC') as grantee,
       a.privilege_type,
       a.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in ('confirm_disruption_tx', 'record_audit_log')
order by p.proname, p.oid, grantee, privilege_type;
```

Expected post-003 function identities from source are `confirm_disruption_tx(text,text,text,jsonb,integer)` and `record_audit_log(text,text,text,text,text,jsonb)`. Confirm actual overloads and privileges in the target project. Do not grant broad access to make a failing test pass.

### Check scoped test rows

Replace the example UUID with the exact disposable test organization's UUID. The CTE makes each query explicitly organization-scoped.

```sql
with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select 'locations' as entity, count(*) as row_count
from public.locations l cross join target where l.org_id = target.org_id
union all
select 'vehicles', count(*) from public.vehicles v cross join target where v.org_id = target.org_id
union all
select 'deliveries', count(*) from public.deliveries d cross join target where d.org_id = target.org_id
union all
select 'plans', count(*) from public.plans p cross join target where p.org_id = target.org_id
union all
select 'plan_stops', count(*) from public.plan_stops s cross join target where s.org_id = target.org_id
union all
select 'disruptions', count(*) from public.disruptions d cross join target where d.org_id = target.org_id
union all
select 'simulation_events', count(*) from public.simulation_events s cross join target where s.org_id = target.org_id
union all
select 'audit_logs', count(*) from public.audit_logs a cross join target where a.org_id = target.org_id;

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select l.id, l.name, l.kind
from public.locations l cross join target
where l.org_id = target.org_id and l.name like 'SMOKE-%'
order by l.name;

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select v.id, v.name, v.capacity, v.depot_id, l.name as depot_name,
       v.shift_start, v.shift_end, v.status
from public.vehicles v
join public.locations l on l.id = v.depot_id and l.org_id = v.org_id
join target on target.org_id = v.org_id
where v.name like 'SMOKE-%'
order by v.name;

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select d.id, d.location_id, l.name as customer_name, d.size, d.service_min,
       d.window_start, d.window_end, d.priority
from public.deliveries d
join public.locations l on l.id = d.location_id and l.org_id = d.org_id
join target on target.org_id = d.org_id
where l.name like 'SMOKE-%'
order by d.id;
```

### Verify plan, disruption, and audit rows

```sql
with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select p.id, p.label, p.parent_plan_id, p.created_at_min, p.created_at,
       p.unassigned, count(s.id) as saved_stop_rows
from public.plans p
left join public.plan_stops s on s.plan_id = p.id and s.org_id = p.org_id
join target on target.org_id = p.org_id
where p.label like 'Replanned at %' or p.label like 'SMOKE-%'
group by p.id
order by p.created_at desc;

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select d.id, d.type, d.at_min, d.confirmed_by, d.confirmed_at, d.raw_text, d.payload
from public.disruptions d
join target on target.org_id = d.org_id
where d.raw_text like 'SMOKE-%' or d.id like 'dis-%'
order by d.at_min;

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
)
select a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.plan_id, a.disruption_id, a.created_at, a.payload
from public.audit_logs a
join target on target.org_id = a.org_id
where a.action in ('disruption_confirmed', 'plan_created', 'plan_updated', 'vehicle_status_changed')
order by a.created_at desc
limit 100;
```

To confirm the profile links for already-provisioned test accounts, replace the example organization UUID and Auth UUIDs:

```sql
with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as org_id
), test_auth_users(id) as (
  values
    ('00000000-0000-0000-0000-000000000000'::uuid),
    ('00000000-0000-0000-0000-000000000000'::uuid),
    ('00000000-0000-0000-0000-000000000000'::uuid)
)
select p.id as auth_user_id, p.org_id, p.name, p.role
from public.profiles p
join target on target.org_id = p.org_id
join test_auth_users u on u.id = p.id
order by p.role, p.id;
```

The disruption UI generates IDs beginning with `dis-` and urgent delivery IDs beginning with `delivery-`; delivery location names with the run prefix are a safer selector than assuming an ID alone identifies the test run. Audit logs are append-only by trigger. Do not update/delete audit rows to clean up test evidence.

## 10. Troubleshooting

- **Demo mode unexpectedly appears:** Check whether both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set for the Vite process. Do not paste their values into chat/logs. Restart Vite after configuration changes.
- **Auth accepted but profile unavailable:** Confirm the Auth user's UUID matches `profiles.id`; profile `org_id`, `name`, and `role` are valid. A profile row is not created automatically by the app. Check Auth/API and database errors without exposing bearer tokens.
- **Table missing/schema cache error:** Check the project's applied migration history and schema cache. Verify 001 → 002 → 003 on the intended test project; do not rerun non-idempotent SQL blindly.
- **Permission/RLS failure:** Confirm the signed-in profile's role/org and inspect `pg_policies`, triggers, and constraints with the read-only queries. Validate using the authenticated app account. SQL Editor results may have elevated privileges and do not show what that JWT can do.
- **Vehicle/delivery foreign-key error:** Vehicle depot must be a depot in the same org; delivery location must be a customer in the same org. Check IDs and composite FK definitions.
- **No plan/compare empty state:** The app cannot generate the initial plan. Obtain a test baseline plan through the project's approved setup path. Compare needs two plans.
- **Replanning says no route timing/matrix:** No matrix table exists. A usable directed travel-time matrix is reconstructed from saved route stops and their arrival/departure times. Do not invent missing route legs or borrow demo timings.
- **AI button returns an error:** Check same-origin `GET /api/ai-status`, server logs, the provider/model variables, provider account/quota, network requests, and `POST /api/interpret-disruption`. The status response should not contain a key. The Supabase Edge Function file is not automatically deployed or called by this browser path.
- **Writes show a partial failure:** Inspect the scoped records before retrying. Earlier sequential writes may have committed. Never blindly resubmit urgent delivery or disruption after a timeout.
- **App displays sample-data warning on live Disruptions/Users:** This is a known stale App banner; page-level live query/error state and scoped database records are the meaningful evidence.
- **Browser logs:** Inspect Console and Network status/body for failed request codes (401, 403, PostgREST schema/constraint errors, network failures). Redact access tokens, cookies, emails, and keys before sharing diagnostics.

## 11. Cleanup

The UI does not delete locations, vehicles, deliveries, plans, disruptions, profiles, or organizations. Do not delete shared records. After verification, retain test data or ask the test-project owner to remove the dedicated test organization through the approved admin process. Migration organization foreign keys cascade to organization-scoped records, but profiles are linked to Auth UUIDs and Auth users are separate; deleting an organization does not itself prove Auth test identities were removed. The project owner should verify and remove only the test Auth users created for this run through the Auth administration interface.

Before removing a disposable organization, verify its exact UUID/name, confirm no real users or shared data belong to it, and have the project owner approve the operation. The migrations include deletion behavior on relationships; in particular, do not delete a parent plan as a smoke test until the deployed `plans_parent_org_fk` action has been reviewed because the source migration's final composite `SET NULL` may conflict with non-null `org_id`.

## 12. Final sign-off checklist

Mark each **Pass**, **Fail**, or **Not tested** and record the project ref (never an API key), organization UUID, role, date, and any failing request IDs.

- [ ] Git working-tree state recorded; no changes were discarded.
- [ ] `npm ci`, `npm test`, and `npm run build` passed locally.
- [ ] Correct non-production Supabase project and migrations 001–003 verified.
- [ ] Admin, dispatcher, and viewer sign-in/session/profile behavior checked.
- [ ] Role-specific navigation and backend write denial checked.
- [ ] Empty, loading, refresh, offline/error behavior checked without demo fallback in live mode.
- [ ] Test locations, vehicle, and deliveries created and verified in scoped SQL.
- [ ] Dashboard metrics and route canvas checked against persisted data.
- [ ] Initial plan availability recorded; plan-generation UI limitation acknowledged.
- [ ] Disruption preview/confirmation/replanning checked, or marked blocked by absent baseline plan/usable route legs.
- [ ] Disruption/audit/vehicle/plan/stop rows checked where applicable.
- [ ] Compare checked with two persisted plans, including unassigned outcomes.
- [ ] User role change and restored role checked as admin; no account creation claimed.
- [ ] Cross-organization behavior tested through separate authenticated accounts.
- [ ] AI provider path passed, failed safely, or marked not configured; no secret exposed.
- [ ] Test data retained or cleanup approved and completed by the project owner.

### Known limitations to carry into sign-off

- The repository has no `.env.example`; local `.env` contents and the target Supabase project are not verified by this document.
- The app cannot create the organization, first admin, Auth users, profiles, or an initial route plan through its UI.
- The route canvas is illustrative, not geospatial.
- Live replanning can only use route-leg timing inferable from persisted plan stops.
- The current Disruptions page does not render AI clarification question fields explicitly.
- A live UI banner incorrectly describes Disruptions and Users as sample-only.
- Migration 003's `plans_parent_org_fk` deletion action requires owner review before parent-plan deletion is tested.
- No live Supabase, RLS, Edge Function deployment, external AI-provider, or production-host verification was performed while preparing this procedure.
