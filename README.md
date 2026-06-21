# Client KOL Selection Console

Client KOL Selection Console is a client-facing review board for campaign-level KOL candidate approval. It lets a client approve, reject, question, export, and audit KOL decisions while the agency keeps a backend event log of every action.

This is not a KOL discovery system. Candidate KOLs are assumed to already exist in a project selection pool. For iLands, the console also shows the strategy layer before the shortlist: target root audience confirmation, target-backed reverse discovery logic, and the signal rules that explain why a KOL is executable.

## Current Surface

- Dark left-nav review console aligned with the iLands client review mock.
- AAA signal-map hero, client preference learning board, root audience confirmation, reverse-discovery method board, KOL execution pool, and signal logic board.
- Inline KOL decisions: approve, reject with reasons, ask a question, view history, and undo a recorded decision.
- Append-only decision event log plus current-state table for fast board reads.
- Optional Twitter241 backend sync for X/Twitter candidate scale and recent timeline metadata.
- JSON and CSV export for follow-up handoff.
- Template-backed project configuration for different client projects.

Live preview:

```text
https://client-kol-selection-console-production.up.railway.app
```

## Project Configs

Project-specific client/campaign metadata and seeded candidate pools are separated from reusable page templates:

```text
server/config/projects/ilands-aaa-signal-map.json
server/config/templates/ilands-root-backed-kol-review.json
```

Project config owns the client-specific layer:

- `projectId`
- `templateId`
- `client`
- `campaign`
- `seed.candidates`
- optional `uiOverrides`

Template config owns the shared review experience:

- navigation and hero copy
- root audience groups
- reverse-discovery method sections
- KOL pool labels
- learning/rule panels
- signal logic board

To add another project:

1. Copy a file under `server/config/projects/`.
2. Change `projectId`, `client`, `campaign`, `seed.candidates`, and keep or change `templateId`.
3. If the new project needs a different page structure, copy a file under `server/config/templates/` and point the project to the new `templateId`.
4. Restart the app.

All config files in `server/config/projects/` are seeded into SQLite on startup if their campaign has no candidates yet. Existing client decisions are not overwritten when project copy changes.

Select a default project:

```bash
KOL_PROJECT_CONFIG=ilands-aaa-signal-map npm run dev
```

Optional Twitter241 sync environment:

```bash
TWITTER241_RAPIDAPI_KEY=your_primary_key
TWITTER241_RAPIDAPI_KEY_FALLBACK=your_fallback_key
TWITTER241_SYNC_TWEET_COUNT=20
```

Open a specific project:

```text
http://localhost:5173/?project=ilands-aaa-signal-map
```

Runtime config endpoints:

```http
GET /api/app-config
GET /api/app-config?project=ilands-aaa-signal-map
GET /api/project-configs
```

## Local Run

Requirements:

- Node.js 24 or newer
- npm

Install and run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The local SQLite database is stored at:

```text
server/data/kol-selection.sqlite
```

Delete that file to reset to the seeded demo board.

## Deployment

The current Railway service serves both the Vite frontend and the Express API:

```text
project: client-kol-selection-console
service: client-kol-selection-console
volume: /data
database: /data/kol-selection.sqlite
```

The deployment uses the included `Dockerfile` and `railway.json`. The SQLite file is mounted on Railway at `/data/kol-selection.sqlite`.

## Data Model

Migration file:

```text
server/migrations/001_create_kol_selection.sql
```

Core tables:

- `clients`
- `campaigns`
- `kol_profiles`
- `campaign_kol_items`
- `kol_selection_events`
- `kol_selection_current_state`
- `kol_selection_followups`

`kol_selection_events` is append-only. `kol_selection_current_state` is updated from each event for fast board reads. Question decisions automatically create `kol_selection_followups`.

## API Examples

Get the board:

```http
GET /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection
```

Approve a KOL:

```http
POST /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/item-kol-mlstreettalk/events
Content-Type: application/json

{
  "to_status": "approved",
  "decision": "approve",
  "reason_tags": [],
  "note": "",
  "client_request_id": "uuid-from-client"
}
```

Reject a KOL:

```http
POST /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/item-kol-trungtphan/events
Content-Type: application/json

{
  "to_status": "rejected",
  "decision": "reject",
  "reason_tags": ["audience_mismatch", "too_generic"],
  "note": "Audience is too broad for this launch round.",
  "client_request_id": "uuid-from-client"
}
```

Create a question follow-up:

```http
POST /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/item-kol-binarybits/events
Content-Type: application/json

{
  "to_status": "question",
  "decision": "question",
  "reason_tags": ["need_price", "need_recent_performance"],
  "note": "Please confirm current pricing and recent performance.",
  "client_request_id": "uuid-from-client"
}
```

Get history:

```http
GET /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/item-kol-trungtphan/events
```

Export:

```http
GET /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/export?format=json
GET /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/export?format=csv
```

Lock selection, internal API only:

```http
POST /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/lock
```

Sync X/Twitter profile scale through Twitter241, internal API only:

```http
POST /api/campaigns/campaign-ilands-root-backed-kol-review/kol-selection/sync-twitter241
Content-Type: application/json
x-actor-role: agency

{
  "handles": ["rohanpaul_ai"],
  "tweetCount": 20
}
```

The sync resolves each handle through `/user?username=...`, then fetches recent timeline data through `/user-tweets?user=<numeric_id>&count=...`. Results are written to `kol_profiles` and `campaign_kol_items.metadata.twitter241`.

## Validation

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Covered behavior:

- Board load and summary counts
- Template-backed project config loading for UI and seed data
- Root audience config loading
- Reject reason validation
- Reject event persistence and current-state update
- Question follow-up creation
- Decision change appends a new event
- `client_request_id` idempotency
- JSON and CSV export grouping
- Client cannot lock final selection
- Twitter241 sync uses numeric user IDs for timeline fetch and preserves live metadata during config re-seeding

## Security Notes

This MVP does not include real authentication or client/campaign authorization middleware. Treat the current public Railway URL as a preview surface, not as a place for confidential client data.

The GitHub repository is intended to be private under `MangoLabsStudio` with access granted to the `full-time` team.

## Next Work

- Add a source/import table for future projects beyond the current JSON-backed config.
- Add authentication and client/campaign authorization middleware.
- Add an operator answer flow for resolving question follow-ups.
- Add table view and virtualization if boards exceed several hundred candidates.
- Add a production database adapter if this moves beyond local MVP.
