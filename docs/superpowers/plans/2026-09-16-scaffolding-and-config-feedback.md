# Scaffolding and Config Plan Feedback

Companion to [2026-09-16-scaffolding-and-config.md](2026-09-16-scaffolding-and-config.md).

## Feedback tracking rule

- Save future feedback about this plan in this file.
- Before changing or executing the plan, read this file and honor the recorded decisions.
- When an accepted item is implemented, update its status and add a short implementation note with the relevant task, file, or commit.
- Do not mark an item implemented merely because the decision was recorded here.

## Review feedback from 2026-09-16

### 1. Startup validation versus lazy validation

**User response:** Needs a clearer explanation.

**Status:** Awaiting decision; not implemented.

**Plain-language explanation:** The PRD says configuration is checked when the app starts. The current plan checks a value only when code first asks for it. In particular, nothing in this plan calls `getClientConfig()`, so the app could start successfully even if the browser-facing Supabase key is missing. The plan must either validate all configuration during startup or change the PRD to say validation happens on first use.

**Implementation note:** None yet.

### 2. Supabase-generated `.gitignore`

**User response:** Accepted ("ok").

**Status:** Implemented in the plan; application work has not started.

**Required change:** Do not assume Supabase initialization generates `supabase/.gitignore`. Add it explicitly with `.branches/` and `.temp/`.

**Implementation note:** Task 5 Step 1 now writes and displays `supabase/.gitignore` explicitly. The earlier suggestion to force `project_id = "map-chat"` was not applied because the plan was subsequently integrated with Supbuddy, which intentionally owns the project id and assigns `sb-map-chat-<8 hex chars>` for isolation.

### 3. Safe `.env.local` generation

**User response:** Needs a clearer explanation.

**Status:** Awaiting decision; not implemented.

**Plain-language explanation:** The planned command writes directly to `.env.local`. The shell empties that file before checking whether `supabase status` succeeds. If the command fails or returns unexpected output, a working `.env.local` can be replaced by an empty or incomplete file. The proposed fix writes to a temporary file, checks that all three expected variables are present, and replaces `.env.local` only after those checks pass.

**Implementation note:** None yet.

### 4. Smoke-test shell hardening

**User response:** Declined ("don't bother").

**Status:** Declined; do not implement unless the user revisits the decision.

**Scope declined:** Portable temporary paths, cleanup traps, explicit test-port handling, and related shell-test hardening. This does not override item 5's requirement that the health check test match the exact reachable state.

**Implementation note:** Not applicable.

### 5. Real health endpoint

**User response:** Accepted: make it a real health endpoint.

**Status:** Implemented in the plan; application work has not started.

**Required change:** When Supabase is reachable, return HTTP 200 with `ok: true`. When it is unreachable, times out, or responds unsuccessfully, return HTTP 503 with `ok: false`. Add a short upstream request timeout. Update smoke checks to match `"supabase":"reachable"` exactly so `"unreachable"` cannot pass accidentally.

**Implementation note:** Task 5's route now uses a two-second timeout, returns HTTP 200 with `ok: true` only for a successful Supabase response, and returns HTTP 503 with `ok: false` for unsuccessful responses, timeouts, and network failures. Both readiness loops now match `"supabase":"reachable"` exactly.
