# Client KOL Selection Console

Client KOL Selection Console is a client-facing review board for campaign-level KOL candidate approval. It lets a client approve, reject, question, hold, export, and audit KOL decisions while the agency keeps a backend event log of every action.

This is not a KOL discovery system. Candidate KOLs are assumed to already exist in a project selection pool. The product focuses on turning client review feedback into a structured execution decision record.

## Current Surface

- Dark left-nav review console aligned with the iLands client review mock.
- AAA signal-map hero, client preference learning board, KOL execution pool, and KOL rule board.
- Inline KOL decisions: approve, reject with reasons, ask a question, hold, and undo.
- Append-only decision event log plus current-state table for fast board reads.
- JSON and CSV export for agency handoff.
- Project-specific configuration files for different client projects.

Live preview:

```text
https://client-kol-selection-console-production.up.railway.app
```

## Project Configs

Project-specific names, client/campaign metadata, page copy, learning rules, KOL list rules, and seeded candidate pools live in JSON config files:

```text
server/project-configs/ilands-aaa-signal-map.json
```

To add another project:

1. Copy `server/project-configs/ilands-aaa-signal-map.json`.
2. Change `projectId`, `client`, `campaign`, `ui`, and `seed.candidates`.
3. Restart the app.

All config files in `server/project-configs/` are seeded into SQLite on startup if their campaign has no candidates yet. Existing campaign decisions are not overwritten.

Select a default project:

```bash
KOL_PROJECT_CONFIG=ilands-aaa-signal-map npm run dev
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
GET /api/campaigns/campaign-frontier-ai-launch/kol-selection
```

Approve a KOL:

```http
POST /api/campaigns/campaign-frontier-ai-launch/kol-selection/item-kol-mira-chen/events
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
POST /api/campaigns/campaign-frontier-ai-launch/kol-selection/item-kol-mira-chen/events
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
POST /api/campaigns/campaign-frontier-ai-launch/kol-selection/item-kol-theo-park/events
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
GET /api/campaigns/campaign-frontier-ai-launch/kol-selection/item-kol-mira-chen/events
```

Export:

```http
GET /api/campaigns/campaign-frontier-ai-launch/kol-selection/export?format=json
GET /api/campaigns/campaign-frontier-ai-launch/kol-selection/export?format=csv
```

Lock selection, agency/admin only:

```http
POST /api/campaigns/campaign-frontier-ai-launch/kol-selection/lock
```

## Validation

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Covered behavior:

- Board load and summary counts
- Project config loading for UI and seed data
- Reject reason validation
- Reject event persistence and current-state update
- Question follow-up creation
- Decision change appends a new event
- `client_request_id` idempotency
- JSON and CSV export grouping
- Client cannot lock final selection

## Security Notes

This MVP does not include real authentication or client/campaign authorization middleware. Treat the current public Railway URL as a preview surface, not as a place for confidential client data.

The GitHub repository is intended to be private under `MangoLabsStudio` with access granted to the `full-time` team.

## Next Work

- Replace seeded demo KOLs with an agency import/source table.
- Add authentication and client/campaign authorization middleware.
- Add agency answer flow for resolving question follow-ups.
- Add table view and virtualization if boards exceed several hundred candidates.
- Add a production database adapter if this moves beyond local MVP.
