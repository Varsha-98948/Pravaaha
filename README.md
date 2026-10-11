# ReRoute
Disruption-aware fleet allocation and replanning (hackathon foundation). Simulated network and travel-time matrix; no GPS or routing APIs.

## Run
`npm install` · `npm run dev` · `npm test` · `npm run build`

## Demo mode
Leave `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` empty (copy `.env.example` to `.env`). The login page then offers "Enter demo" and a role switcher for testing role-based navigation.

## Database
Create a Supabase project, put the URL and anon key in `.env`, then run `supabase/migrations/001_init.sql` in the SQL editor. Roles are guarded by a trigger; clients cannot self-promote. Never put service-role or AI keys in frontend code.

## Structure
`src/types` shared contracts (times = minutes from start) · `src/engine` planning (no React) · `src/services` Supabase + AI interpreter interface · `src/data` demo data · `src/pages`, `src/components` UI · `tests` Vitest.

## Working vs placeholder
Working: navigation, role-based nav, fleet/deliveries/route timelines, baseline greedy allocator with capacity + window checks, arrival/waiting calculation, plan comparison, demo data, SQL + RLS.
Placeholder: `replan()` (throws NotImplementedError), AI interpretation, seeded revised plan, Users page actions, Supabase data loading (UI reads demo data), plan persistence.

## Parallel work split
A: `src/engine` (replan, better allocation) · B: `src/pages` + `src/components` (live state, disruption forms, wiring replan) · C: `src/services` + `supabase/` (data loading, auth profile, interpreter edge function).
