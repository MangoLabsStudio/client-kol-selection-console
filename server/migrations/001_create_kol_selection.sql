PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  review_round TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  locked_at TEXT,
  last_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kol_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  followers INTEGER NOT NULL DEFAULT 0,
  region TEXT NOT NULL,
  language TEXT NOT NULL,
  content_category TEXT NOT NULL,
  email TEXT,
  contact_url TEXT,
  audience_summary TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_kol_items (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  kol_id TEXT NOT NULL REFERENCES kol_profiles(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  status_current TEXT NOT NULL DEFAULT 'pending',
  client_facing_note TEXT NOT NULL DEFAULT '',
  agency_internal_note TEXT NOT NULL DEFAULT '',
  why_included TEXT NOT NULL DEFAULT '',
  recommended_angle TEXT NOT NULL DEFAULT '',
  estimated_price TEXT NOT NULL DEFAULT '',
  contact_status TEXT NOT NULL DEFAULT 'unknown',
  risk_tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_kol_items_campaign ON campaign_kol_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_kol_items_client ON campaign_kol_items(client_id);

CREATE TABLE IF NOT EXISTS kol_selection_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  campaign_kol_item_id TEXT REFERENCES campaign_kol_items(id),
  kol_id TEXT REFERENCES kol_profiles(id),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  decision TEXT,
  reason_tags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'client_visible',
  client_request_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kol_selection_events_request
  ON kol_selection_events(client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kol_selection_events_item ON kol_selection_events(campaign_kol_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kol_selection_events_campaign ON kol_selection_events(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS kol_selection_current_state (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  campaign_kol_item_id TEXT NOT NULL REFERENCES campaign_kol_items(id) ON DELETE CASCADE,
  kol_id TEXT NOT NULL REFERENCES kol_profiles(id) ON DELETE CASCADE,
  current_status TEXT NOT NULL DEFAULT 'pending',
  current_decision TEXT NOT NULL DEFAULT 'pending',
  current_reason_tags TEXT NOT NULL DEFAULT '[]',
  current_note TEXT NOT NULL DEFAULT '',
  last_event_id TEXT REFERENCES kol_selection_events(id),
  last_actor_id TEXT NOT NULL,
  last_actor_role TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_kol_item_id)
);

CREATE INDEX IF NOT EXISTS idx_kol_selection_current_campaign ON kol_selection_current_state(campaign_id, current_status);

CREATE TABLE IF NOT EXISTS client_action_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  surface TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  reason_tags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  client_request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_action_events_request
  ON client_action_events(client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_action_events_campaign ON client_action_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_client_action_events_surface ON client_action_events(campaign_id, surface, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS kol_selection_followups (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  campaign_kol_item_id TEXT NOT NULL REFERENCES campaign_kol_items(id) ON DELETE CASCADE,
  kol_id TEXT NOT NULL REFERENCES kol_profiles(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  answer_text TEXT,
  created_from_event_id TEXT NOT NULL REFERENCES kol_selection_events(id),
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS root_audience_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  round INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'system',
  client_request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_root_audience_snapshots_request
  ON root_audience_snapshots(client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_root_audience_snapshots_campaign
  ON root_audience_snapshots(campaign_id, round, created_at);

CREATE TABLE IF NOT EXISTS root_kol_edges (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  root_handle TEXT NOT NULL,
  root_name TEXT NOT NULL DEFAULT '',
  root_group TEXT NOT NULL DEFAULT '',
  campaign_kol_item_id TEXT NOT NULL REFERENCES campaign_kol_items(id) ON DELETE CASCADE,
  kol_id TEXT NOT NULL REFERENCES kol_profiles(id) ON DELETE CASCADE,
  kol_handle TEXT NOT NULL,
  edge_type TEXT NOT NULL DEFAULT 'inferred',
  edge_source TEXT NOT NULL DEFAULT 'manual',
  confidence REAL NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, root_handle, campaign_kol_item_id, edge_source)
);

CREATE INDEX IF NOT EXISTS idx_root_kol_edges_campaign_root
  ON root_kol_edges(campaign_id, root_handle, confidence);

CREATE INDEX IF NOT EXISTS idx_root_kol_edges_campaign_kol
  ON root_kol_edges(campaign_id, campaign_kol_item_id, confidence);

CREATE TABLE IF NOT EXISTS kol_generation_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  source_snapshot_id TEXT NOT NULL REFERENCES root_audience_snapshots(id),
  status TEXT NOT NULL DEFAULT 'pending',
  version_label TEXT NOT NULL,
  trigger_actor_id TEXT NOT NULL,
  trigger_actor_role TEXT NOT NULL,
  trigger_reason TEXT NOT NULL DEFAULT 'root_audience_confirmed',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kol_generation_runs_request
  ON kol_generation_runs(client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kol_generation_runs_campaign
  ON kol_generation_runs(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS kol_generation_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES kol_generation_runs(id),
  campaign_kol_item_id TEXT NOT NULL REFERENCES campaign_kol_items(id),
  display_order INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  explanation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, campaign_kol_item_id)
);

CREATE INDEX IF NOT EXISTS idx_kol_generation_run_items_run
  ON kol_generation_run_items(run_id, display_order);

CREATE TABLE IF NOT EXISTS kol_feedback_learning_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  campaign_kol_item_id TEXT NOT NULL REFERENCES campaign_kol_items(id),
  action_type TEXT NOT NULL,
  reason_tags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  source_event_id TEXT REFERENCES kol_selection_events(id),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kol_feedback_learning_events_campaign
  ON kol_feedback_learning_events(campaign_id, created_at);

CREATE INDEX IF NOT EXISTS idx_kol_feedback_learning_events_item
  ON kol_feedback_learning_events(campaign_kol_item_id, created_at);
