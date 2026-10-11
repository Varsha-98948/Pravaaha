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
## AI Disruption Interpreter (OpenRouter Multi-Key Failover)

ReRoute provides natural-language disruption intake powered by OpenRouter using **strict free-only models** and an **automatic 3-key failover system**.

### 1. Configuration & Secrets

Configure three independent OpenRouter API keys from three separate free accounts in `.env`:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY_1=sk-or-v1-...
OPENROUTER_API_KEY_2=sk-or-v1-...
OPENROUTER_API_KEY_3=sk-or-v1-...

OPENROUTER_FREE_MODEL=apodex/apodex-1.1-mini:free
OPENROUTER_FREE_MODEL_ALLOWLIST=apodex/apodex-1.1-mini:free,openrouter/free
OPENROUTER_PAID_FALLBACK_ENABLED=false
```

- Keys are kept strictly on the backend (Vite middleware / Node.js) and never exposed to the client bundle or logs.
- Secret files (`.env`, `.env.local`) are excluded from version control in `.gitignore`. Use `.env.example` as a template.

### 2. Strict Free-Only Model Policy

- Only approved models verified as zero-priced in the OpenRouter catalog are permitted. Some currently free model IDs do not end in `:free`, so do not infer pricing from the suffix alone.
- `OPENROUTER_PAID_FALLBACK_ENABLED` is enforced as `false`. Any attempt to request a paid model or enable paid fallback is rejected server-side before making a network call.
- The server fails closed rather than risking paid requests.

### 3. Key Rotation & Automatic Failover

- **Fair Selection:** Concurrency-safe round-robin selection among healthy keys.
- **Credit Exhaustion / Billing Restrictions (HTTP 402):** Detected and marks the key slot as `credit_exhausted`. Immediately fails over to the next eligible key. The slot remains disabled until reloaded or reset.
- **Rate Limits (HTTP 429):** Reads `Retry-After` headers and applies a cooldown. Fails over to another eligible key. If all keys are rate-limited, returns a clear temporary unavailability response.
- **Authentication Failures (HTTP 401/403):** Marks key as `auth_failed` and fails over.
- **Transient Failures (HTTP 5xx, timeouts):** Bounded retry on the next key with short cooldowns.
- **Request Errors (HTTP 400 Bad Request):** Fails immediately without disabling healthy keys.
- **Model Availability Failures (HTTP 404 "No endpoints found", unsupported model):** Does not mark API keys unhealthy and tries the next approved verified free model, if configured.
- **Bounded Retries:** Each key is attempted at most once per logical request. Infinite retry loops are impossible.

### 4. Process Restarts & Multi-Instance Architecture

- Key operational states (cooldowns, rate limits, credit status) are held in backend process memory.
- If the server restarts, temporary cooldowns reset and healthy keys are re-evaluated from `.env`.
- For multi-instance clustered deployments, each instance manages its local rotation safely; for centralized state across many server instances, a shared Redis or database-backed key state store can be introduced.

### 5. Recommended Provider-Side Controls

While application-level safeguards strictly enforce free models, we recommend configuring these controls directly on each OpenRouter account:
- Set account spending limits to $0.00.
- Disable auto-recharge on credit cards.
- Generate read/inference scoped API keys.
