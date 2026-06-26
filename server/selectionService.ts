import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ApiError,
  selectionStatuses,
  type ActorRole,
  type CreateClientActionEventInput,
  type CreateKolGenerationRunInput,
  type CreateRootAudienceSnapshotInput,
  type DiscoveredKolCandidateInput,
  type CreateSelectionEventInput,
  type SelectionStatus,
  type Summary
} from "./types.js";

const statusSet = new Set<string>(selectionStatuses);

type Row = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function readJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueTags(tags?: string[]) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
}

function assertStatus(status: string): asserts status is SelectionStatus {
  if (!statusSet.has(status)) {
    throw new ApiError(400, `不支持的评审状态：${status}`);
  }
}

function getItemForUpdate(db: DatabaseSync, campaignId: string, itemId: string) {
  const item = db
    .prepare(
      `SELECT
        i.*,
        COALESCE(s.current_status, i.status_current, 'pending') AS effective_status,
        s.last_event_id AS last_event_id
      FROM campaign_kol_items i
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = i.id
      WHERE i.campaign_id = ? AND i.id = ?`
    )
    .get(campaignId, itemId);

  if (!item) throw new ApiError(404, "未找到该候选账号。");
  return item;
}

function getEventByRequest(db: DatabaseSync, clientRequestId?: string) {
  if (!clientRequestId) return undefined;
  return db.prepare("SELECT * FROM kol_selection_events WHERE client_request_id = ?").get(clientRequestId);
}

function getClientActionEventByRequest(db: DatabaseSync, clientRequestId?: string) {
  if (!clientRequestId) return undefined;
  return db.prepare("SELECT * FROM client_action_events WHERE client_request_id = ?").get(clientRequestId);
}

function getRootSnapshotByRequest(db: DatabaseSync, clientRequestId?: string) {
  if (!clientRequestId) return undefined;
  return db.prepare("SELECT * FROM root_audience_snapshots WHERE client_request_id = ?").get(clientRequestId);
}

function getGenerationRunByRequest(db: DatabaseSync, clientRequestId?: string) {
  if (!clientRequestId) return undefined;
  return db.prepare("SELECT * FROM kol_generation_runs WHERE client_request_id = ?").get(clientRequestId);
}

export function getCampaignBoard(db: DatabaseSync, campaignId: string, actorRole: ActorRole = "client") {
  const campaign = db
    .prepare(
      `SELECT
        c.id,
        c.client_id,
        c.name,
        c.review_round,
        c.objective,
        c.locked_at,
        c.last_updated_at,
        c.created_at,
        cl.name AS client_name,
        cl.tier AS client_tier
      FROM campaigns c
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ?`
    )
    .get(campaignId);

  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const activeRun = getLatestGenerationRun(db, campaignId);
  const itemRows = activeRun
    ? db
        .prepare(
          `SELECT
        i.id AS item_id,
        i.client_id AS item_client_id,
        i.campaign_id AS item_campaign_id,
        gri.display_order,
        gri.run_id AS generation_run_id,
        i.display_order AS base_display_order,
        i.status_current,
        i.client_facing_note,
        i.agency_internal_note,
        i.why_included,
        i.recommended_angle,
        i.estimated_price,
        i.contact_status,
        i.risk_tags,
        i.metadata AS item_metadata,
        i.updated_at AS item_updated_at,
        p.id AS kol_id,
        p.name AS kol_name,
        p.handle,
        p.platform,
        p.profile_url,
        p.avatar_url,
        p.bio,
        p.followers,
        p.region,
        p.language,
        p.content_category,
        p.audience_summary,
        p.metadata AS kol_metadata,
        gri.score AS generation_score,
        gri.explanation_json AS generation_explanation,
        s.id AS state_id,
        s.current_status,
        s.current_decision,
        s.current_reason_tags,
        s.current_note,
        s.last_event_id,
        s.last_actor_id,
        s.last_actor_role,
        s.last_updated_at
      FROM campaign_kol_items i
      JOIN kol_generation_run_items gri ON gri.campaign_kol_item_id = i.id
      JOIN kol_profiles p ON p.id = i.kol_id
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = i.id
      WHERE i.campaign_id = ? AND gri.run_id = ?
      ORDER BY gri.display_order ASC`
        )
        .all(campaignId, activeRun.id)
    : db
        .prepare(
          `SELECT
        i.id AS item_id,
        i.client_id AS item_client_id,
        i.campaign_id AS item_campaign_id,
        i.display_order,
        NULL AS generation_run_id,
        i.display_order AS base_display_order,
        i.status_current,
        i.client_facing_note,
        i.agency_internal_note,
        i.why_included,
        i.recommended_angle,
        i.estimated_price,
        i.contact_status,
        i.risk_tags,
        i.metadata AS item_metadata,
        i.updated_at AS item_updated_at,
        p.id AS kol_id,
        p.name AS kol_name,
        p.handle,
        p.platform,
        p.profile_url,
        p.avatar_url,
        p.bio,
        p.followers,
        p.region,
        p.language,
        p.content_category,
        p.audience_summary,
        p.metadata AS kol_metadata,
        NULL AS generation_score,
        NULL AS generation_explanation,
        s.id AS state_id,
        s.current_status,
        s.current_decision,
        s.current_reason_tags,
        s.current_note,
        s.last_event_id,
        s.last_actor_id,
        s.last_actor_role,
        s.last_updated_at
      FROM campaign_kol_items i
      JOIN kol_profiles p ON p.id = i.kol_id
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = i.id
      WHERE i.campaign_id = ?
      ORDER BY i.display_order ASC`
        )
        .all(campaignId);

  const items = itemRows.map((row) => normalizeBoardItem(row, actorRole));

  return {
    campaign: normalizeCampaign(campaign),
    summary: summarizeBoardItems(items),
    activeGenerationRun: activeRun,
    items
  };
}

function summarizeBoardItems(items: Array<{ currentState: { currentStatus: string } }>): Summary {
  const summary: Summary = {
    total: items.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    question: 0,
    hold: 0
  };

  for (const item of items) {
    const status = item.currentState.currentStatus;
    if (statusSet.has(status)) summary[status as SelectionStatus] += 1;
  }

  return summary;
}

export function getCampaignSelectionSummary(db: DatabaseSync, campaignId: string): Summary {
  const summary: Summary = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    question: 0,
    hold: 0
  };

  const total = db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ?").get(campaignId);
  summary.total = Number(total?.count ?? 0);

  const rows = db
    .prepare(
      `SELECT COALESCE(s.current_status, i.status_current, 'pending') AS status, COUNT(*) AS count
      FROM campaign_kol_items i
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = i.id
      WHERE i.campaign_id = ?
      GROUP BY COALESCE(s.current_status, i.status_current, 'pending')`
    )
    .all(campaignId);

  rows.forEach((row) => {
    const status = String(row.status);
    if (statusSet.has(status)) {
      summary[status as SelectionStatus] = Number(row.count ?? 0);
    }
  });

  return summary;
}

export function createSelectionEvent(db: DatabaseSync, input: CreateSelectionEventInput) {
  assertStatus(input.toStatus);

  const existing = getEventByRequest(db, input.clientRequestId);
  if (existing) {
    return {
      event: normalizeEvent(existing),
      currentState: getCurrentState(db, String(existing.campaign_kol_item_id)),
      summary: getCampaignSelectionSummary(db, String(existing.campaign_id))
    };
  }

  const item = getItemForUpdate(db, input.campaignId, input.itemId);
  const tags = uniqueTags(input.reasonTags);
  const note = input.note?.trim() ?? "";
  const fromStatus = String(item.effective_status ?? "pending");
  assertStatus(fromStatus);

  if (input.toStatus === "rejected" && tags.length === 0) {
    throw new ApiError(400, "请至少选择一个排除原因。");
  }

  if (input.toStatus === "question" && tags.length === 0) {
    throw new ApiError(400, "请至少选择一个补充信息类型。");
  }

  if (input.toStatus === "question" && note.length === 0) {
    throw new ApiError(400, "请写明需要补充确认的问题。");
  }

  const timestamp = nowIso();
  const eventId = randomUUID();
  const eventType = getEventType(fromStatus, input.toStatus, input.decision);
  const visibility = input.visibility ?? "client_visible";
  const decision = decisionForStatus(input.toStatus);

  db.exec("BEGIN IMMEDIATE");
  try {
    db
      .prepare(
        `INSERT INTO kol_selection_events (
          id, client_id, campaign_id, campaign_kol_item_id, kol_id, actor_id, actor_role,
          event_type, from_status, to_status, decision, reason_tags, note, visibility,
          client_request_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        item.client_id,
        input.campaignId,
        input.itemId,
        item.kol_id,
        input.actorId,
        input.actorRole,
        eventType,
        fromStatus,
        input.toStatus,
        decision,
        JSON.stringify(tags),
        note,
        visibility,
        input.clientRequestId ?? null,
        JSON.stringify(input.metadata ?? {}),
        timestamp
      );

    db
      .prepare(
        `INSERT INTO kol_selection_current_state (
          id, client_id, campaign_id, campaign_kol_item_id, kol_id, current_status, current_decision,
          current_reason_tags, current_note, last_event_id, last_actor_id, last_actor_role,
          last_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_kol_item_id) DO UPDATE SET
          current_status = excluded.current_status,
          current_decision = excluded.current_decision,
          current_reason_tags = excluded.current_reason_tags,
          current_note = excluded.current_note,
          last_event_id = excluded.last_event_id,
          last_actor_id = excluded.last_actor_id,
          last_actor_role = excluded.last_actor_role,
          last_updated_at = excluded.last_updated_at,
          updated_at = excluded.updated_at`
      )
      .run(
        randomUUID(),
        item.client_id,
        input.campaignId,
        input.itemId,
        item.kol_id,
        input.toStatus,
        decision,
        JSON.stringify(tags),
        note,
        eventId,
        input.actorId,
        input.actorRole,
        timestamp,
        timestamp,
        timestamp
      );

    db
      .prepare("UPDATE campaign_kol_items SET status_current = ?, updated_at = ? WHERE id = ?")
      .run(input.toStatus, timestamp, input.itemId);
    db.prepare("UPDATE campaigns SET last_updated_at = ? WHERE id = ?").run(timestamp, input.campaignId);

    if (input.toStatus === "question") {
      db
        .prepare(
          `INSERT INTO kol_selection_followups (
            id, client_id, campaign_id, campaign_kol_item_id, kol_id, task_type, question_text,
            status, assigned_to, answer_text, created_from_event_id, resolved_by, resolved_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          item.client_id,
          input.campaignId,
          input.itemId,
          item.kol_id,
          tags[0] ?? "other",
          note,
          "open",
          null,
          null,
          eventId,
          null,
          null,
          timestamp,
          timestamp
        );
    }

    if (input.toStatus === "rejected" || input.toStatus === "question") {
      db
        .prepare(
          `INSERT INTO kol_feedback_learning_events (
            id, client_id, campaign_id, campaign_kol_item_id, action_type, reason_tags,
            note, source_event_id, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          item.client_id,
          input.campaignId,
          input.itemId,
          input.toStatus,
          JSON.stringify(tags),
          note,
          eventId,
          JSON.stringify({
            fromStatus,
            toStatus: input.toStatus,
            decision,
            actorRole: input.actorRole
          }),
          timestamp
        );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const event = db.prepare("SELECT * FROM kol_selection_events WHERE id = ?").get(eventId);
  return {
    event: normalizeEvent(event),
    currentState: getCurrentState(db, input.itemId),
    summary: getCampaignSelectionSummary(db, input.campaignId)
  };
}

function getEventType(fromStatus: SelectionStatus, toStatus: SelectionStatus, decision: CreateSelectionEventInput["decision"]) {
  if (decision === "undo" || toStatus === "pending") return "undo";
  if (fromStatus !== "pending" && fromStatus !== toStatus) return "decision_changed";
  if (fromStatus === toStatus) return "reason_updated";
  return "decision_created";
}

function decisionForStatus(status: SelectionStatus) {
  if (status === "approved") return "approve";
  if (status === "rejected") return "reject";
  return status;
}

export function getSelectionHistory(db: DatabaseSync, campaignId: string, itemId: string) {
  getItemForUpdate(db, campaignId, itemId);
  return db
    .prepare(
      `SELECT * FROM kol_selection_events
      WHERE campaign_id = ? AND campaign_kol_item_id = ?
      ORDER BY created_at DESC`
    )
    .all(campaignId, itemId)
    .map(normalizeEvent);
}

export function createClientActionEvent(db: DatabaseSync, input: CreateClientActionEventInput) {
  const existing = getClientActionEventByRequest(db, input.clientRequestId);
  if (existing) return normalizeClientActionEvent(existing);

  const campaign = db.prepare("SELECT id, client_id FROM campaigns WHERE id = ?").get(input.campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const surface = input.surface.trim();
  const entityType = input.entityType.trim();
  const entityId = input.entityId.trim();
  const actionType = input.actionType.trim();
  if (!surface || !entityType || !entityId || !actionType) {
    throw new ApiError(400, "行为日志缺少必要字段。");
  }

  const timestamp = nowIso();
  const eventId = randomUUID();
  db
    .prepare(
      `INSERT INTO client_action_events (
        id, client_id, campaign_id, surface, entity_type, entity_id, action_type,
        actor_id, actor_role, from_value, to_value, reason_tags, note, metadata,
        client_request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      campaign.client_id,
      input.campaignId,
      surface,
      entityType,
      entityId,
      actionType,
      input.actorId,
      input.actorRole,
      input.fromValue ?? null,
      input.toValue ?? null,
      JSON.stringify(uniqueTags(input.reasonTags)),
      input.note?.trim() ?? "",
      JSON.stringify(input.metadata ?? {}),
      input.clientRequestId ?? null,
      timestamp
    );
  db.prepare("UPDATE campaigns SET last_updated_at = ? WHERE id = ?").run(timestamp, input.campaignId);

  return normalizeClientActionEvent(db.prepare("SELECT * FROM client_action_events WHERE id = ?").get(eventId));
}

export function getClientActionEvents(
  db: DatabaseSync,
  campaignId: string,
  filters: { surface?: string; entityType?: string; entityId?: string; limit?: number } = {}
) {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const clauses = ["campaign_id = ?"];
  const params: Array<string | number> = [campaignId];
  if (filters.surface) {
    clauses.push("surface = ?");
    params.push(filters.surface);
  }
  if (filters.entityType) {
    clauses.push("entity_type = ?");
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    clauses.push("entity_id = ?");
    params.push(filters.entityId);
  }

  const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(Number(filters.limit), 1000)) : 500;
  params.push(limit);

  return db
    .prepare(
      `SELECT * FROM client_action_events
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`
    )
    .all(...params)
    .map(normalizeClientActionEvent);
}

export function createRootAudienceSnapshot(db: DatabaseSync, input: CreateRootAudienceSnapshotInput) {
  const existing = getRootSnapshotByRequest(db, input.clientRequestId);
  if (existing) return normalizeRootAudienceSnapshot(existing);

  const campaign = db.prepare("SELECT id, client_id FROM campaigns WHERE id = ?").get(input.campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const round = Math.max(1, Number(input.round || input.snapshot.round || 1));
  const timestamp = nowIso();
  const snapshotId = randomUUID();
  const snapshot = {
    ...input.snapshot,
    round,
    capturedAt: timestamp,
    capturedBy: input.actorId,
    actorRole: input.actorRole
  };

  db
    .prepare(
      `INSERT INTO root_audience_snapshots (
        id, client_id, campaign_id, round, snapshot_json, created_by, client_request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(snapshotId, campaign.client_id, input.campaignId, round, JSON.stringify(snapshot), input.actorId, input.clientRequestId ?? null, timestamp);
  db.prepare("UPDATE campaigns SET last_updated_at = ? WHERE id = ?").run(timestamp, input.campaignId);

  return normalizeRootAudienceSnapshot(db.prepare("SELECT * FROM root_audience_snapshots WHERE id = ?").get(snapshotId));
}

export function getLatestRootAudienceSnapshot(db: DatabaseSync, campaignId: string) {
  const row = db
    .prepare(
      `SELECT * FROM root_audience_snapshots
      WHERE campaign_id = ?
      ORDER BY created_at DESC
      LIMIT 1`
    )
    .get(campaignId);
  return row ? normalizeRootAudienceSnapshot(row) : null;
}

export function getRootAudienceSnapshot(db: DatabaseSync, campaignId: string, snapshotId: string) {
  const row = db.prepare("SELECT * FROM root_audience_snapshots WHERE campaign_id = ? AND id = ?").get(campaignId, snapshotId);
  return row ? normalizeRootAudienceSnapshot(row) : null;
}

export function getRootAudienceSnapshots(db: DatabaseSync, campaignId: string) {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  return db
    .prepare(
      `SELECT * FROM root_audience_snapshots
      WHERE campaign_id = ?
      ORDER BY created_at DESC`
    )
    .all(campaignId)
    .map(normalizeRootAudienceSnapshot);
}

export function createKolGenerationRun(db: DatabaseSync, input: CreateKolGenerationRunInput) {
  const existing = getGenerationRunByRequest(db, input.clientRequestId);
  if (existing) return getGenerationRunWithItems(db, String(existing.id));

  const snapshot = db
    .prepare("SELECT * FROM root_audience_snapshots WHERE campaign_id = ? AND id = ?")
    .get(input.campaignId, input.sourceSnapshotId);
  if (!snapshot) throw new ApiError(404, "未找到目标人群确认快照。");

  const campaign = db.prepare("SELECT id, client_id FROM campaigns WHERE id = ?").get(input.campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const timestamp = nowIso();
  const runId = randomUUID();
  const runCount = db.prepare("SELECT COUNT(*) AS count FROM kol_generation_runs WHERE campaign_id = ?").get(input.campaignId);
  const versionLabel = input.versionLabel?.trim() || `Round ${Number(runCount?.count ?? 0) + 2} · 107 基础池更新`;
  const snapshotPayload = readJsonObject(snapshot.snapshot_json);
  const hasDiscoveredCandidates = (input.discoveredCandidates?.length ?? 0) > 0;
  const baseItemCount = Number(
    db
      .prepare(
        hasDiscoveredCandidates
          ? "SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ?"
          : "SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ? AND COALESCE(created_by, '') <> 'twitter241_discovery'"
      )
      .get(input.campaignId)?.count ?? 0
  );
  const itemLimit = clampRunItemLimit(input.itemLimit ?? baseItemCount);
  const discoveryMetadata = input.discoveryMetadata ?? {};
  const discoveryStrategy = typeof discoveryMetadata.strategy === "string" ? discoveryMetadata.strategy : undefined;
  const runMetadata: Record<string, unknown> = {
    source: "root_audience_snapshot",
    generator: discoveryStrategy ?? (hasDiscoveredCandidates ? "kol_universe_then_root_filter_v1" : "seed_pool_root_filter_v1"),
    itemLimit,
    ...input.metadata,
    discovery: discoveryMetadata
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    const discoveryWrite = upsertDiscoveredCandidates(db, {
      campaignId: input.campaignId,
      clientId: String(campaign.client_id),
      runId,
      timestamp,
      candidates: input.discoveredCandidates ?? []
    });
    runMetadata.discoveryWrite = discoveryWrite;
    const rankedItems = rankItemsForSnapshot(db, input.campaignId, snapshotPayload, itemLimit, { includeDiscovered: hasDiscoveredCandidates });

    db
      .prepare(
        `INSERT INTO kol_generation_runs (
          id, client_id, campaign_id, source_snapshot_id, status, version_label,
          trigger_actor_id, trigger_actor_role, trigger_reason, metadata_json,
          client_request_id, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        campaign.client_id,
        input.campaignId,
        input.sourceSnapshotId,
        "succeeded",
        versionLabel,
        input.actorId,
        input.actorRole,
        input.triggerReason?.trim() || "root_audience_confirmed",
        JSON.stringify(runMetadata),
        input.clientRequestId ?? null,
        timestamp,
        timestamp
      );

    const insertRunItem = db.prepare(
      `INSERT INTO kol_generation_run_items (
        id, run_id, campaign_kol_item_id, display_order, score, explanation_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    rankedItems.forEach((item, index) => {
      insertRunItem.run(randomUUID(), runId, item.itemId, index + 1, item.score, JSON.stringify(item.explanation), timestamp);
    });

    db
      .prepare("UPDATE campaigns SET review_round = ?, last_updated_at = ? WHERE id = ?")
      .run(versionLabel, timestamp, input.campaignId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getGenerationRunWithItems(db, runId);
}

export function resetKolReviewState(
  db: DatabaseSync,
  input: {
    campaignId: string;
    actorId: string;
    actorRole: ActorRole;
    clientRequestId?: string;
    note?: string;
  }
) {
  const existing = getClientActionEventByRequest(db, input.clientRequestId);
  if (existing) return getCampaignBoard(db, input.campaignId, input.actorRole);

  const campaign = db.prepare("SELECT id, client_id FROM campaigns WHERE id = ?").get(input.campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const activeRun = getLatestGenerationRun(db, input.campaignId);
  const latestSnapshot = activeRun ? null : getLatestRootAudienceSnapshot(db, input.campaignId);
  const sourceSnapshotId = activeRun?.sourceSnapshotId ?? latestSnapshot?.id ?? null;
  const timestamp = nowIso();
  const resetNote = input.note?.trim() || "KOL list reset to the initial candidate pool.";
  const nonPendingItems = db
    .prepare(
      `SELECT
        i.id AS item_id,
        i.client_id,
        i.campaign_id,
        i.kol_id,
        COALESCE(s.current_status, i.status_current, 'pending') AS effective_status
      FROM campaign_kol_items i
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = i.id
      WHERE i.campaign_id = ?
        AND COALESCE(s.current_status, i.status_current, 'pending') <> 'pending'
      ORDER BY i.display_order ASC`
    )
    .all(input.campaignId);
  const baseItems = sourceSnapshotId
    ? db
        .prepare(
          `SELECT id, display_order
          FROM campaign_kol_items
          WHERE campaign_id = ? AND COALESCE(created_by, '') <> 'twitter241_discovery'
          ORDER BY display_order ASC`
        )
        .all(input.campaignId)
    : [];

  db.exec("BEGIN IMMEDIATE");
  try {
    db
      .prepare(
        `INSERT INTO client_action_events (
          id, client_id, campaign_id, surface, entity_type, entity_id, action_type,
          actor_id, actor_role, from_value, to_value, reason_tags, note, metadata,
          client_request_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        campaign.client_id,
        input.campaignId,
        "kol_selection",
        "campaign",
        input.campaignId,
        "kol_list_reset",
        input.actorId,
        input.actorRole,
        activeRun?.versionLabel ?? "initial_board",
        "initial_seed_pool",
        JSON.stringify(["kol_list_reset"]),
        resetNote,
        JSON.stringify({
          previousGenerationRunId: activeRun?.id ?? null,
          sourceSnapshotId,
          basePoolItemCount: baseItems.length,
          resetCurrentStateCount: nonPendingItems.length
        }),
        input.clientRequestId ?? null,
        timestamp
      );

    const insertResetEvent = db.prepare(
      `INSERT INTO kol_selection_events (
        id, client_id, campaign_id, campaign_kol_item_id, kol_id, actor_id, actor_role,
        event_type, from_status, to_status, decision, reason_tags, note, visibility,
        client_request_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const upsertCurrentState = db.prepare(
      `INSERT INTO kol_selection_current_state (
        id, client_id, campaign_id, campaign_kol_item_id, kol_id, current_status, current_decision,
        current_reason_tags, current_note, last_event_id, last_actor_id, last_actor_role,
        last_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_kol_item_id) DO UPDATE SET
        current_status = excluded.current_status,
        current_decision = excluded.current_decision,
        current_reason_tags = excluded.current_reason_tags,
        current_note = excluded.current_note,
        last_event_id = excluded.last_event_id,
        last_actor_id = excluded.last_actor_id,
        last_actor_role = excluded.last_actor_role,
        last_updated_at = excluded.last_updated_at,
        updated_at = excluded.updated_at`
    );

    nonPendingItems.forEach((item) => {
      const eventId = randomUUID();
      insertResetEvent.run(
        eventId,
        item.client_id,
        input.campaignId,
        item.item_id,
        item.kol_id,
        input.actorId,
        input.actorRole,
        "undo",
        item.effective_status,
        "pending",
        "pending",
        JSON.stringify(["kol_list_reset"]),
        resetNote,
        "client_visible",
        input.clientRequestId ? `${input.clientRequestId}:item:${String(item.item_id)}` : null,
        JSON.stringify({ resetScope: "kol_current_state", previousStatus: item.effective_status }),
        timestamp
      );
      upsertCurrentState.run(
        randomUUID(),
        item.client_id,
        input.campaignId,
        item.item_id,
        item.kol_id,
        "pending",
        "pending",
        JSON.stringify([]),
        "",
        eventId,
        input.actorId,
        input.actorRole,
        timestamp,
        timestamp,
        timestamp
      );
    });

    db
      .prepare(
        `UPDATE kol_selection_followups
        SET status = 'reset', answer_text = COALESCE(NULLIF(answer_text, ''), ?), resolved_by = ?,
          resolved_at = ?, updated_at = ?
        WHERE campaign_id = ? AND status = 'open'`
      )
      .run("Closed by KOL list reset.", input.actorId, timestamp, timestamp, input.campaignId);
    db
      .prepare("UPDATE campaign_kol_items SET status_current = 'pending', updated_at = ? WHERE campaign_id = ?")
      .run(timestamp, input.campaignId);

    if (sourceSnapshotId && baseItems.length > 0) {
      const runId = randomUUID();
      const versionLabel = "初始候选池";
      db
        .prepare(
          `INSERT INTO kol_generation_runs (
            id, client_id, campaign_id, source_snapshot_id, status, version_label,
            trigger_actor_id, trigger_actor_role, trigger_reason, metadata_json,
            client_request_id, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          runId,
          campaign.client_id,
          input.campaignId,
          sourceSnapshotId,
          "succeeded",
          versionLabel,
          input.actorId,
          input.actorRole,
          "kol_list_reset_to_seed_pool",
          JSON.stringify({
            source: "seed_pool_reset",
            generator: "seed_pool_reset_v1",
            itemLimit: baseItems.length,
            reset: {
              previousGenerationRunId: activeRun?.id ?? null,
              currentStateEvents: nonPendingItems.length
            }
          }),
          input.clientRequestId ? `${input.clientRequestId}:generation` : null,
          timestamp,
          timestamp
        );

      const insertRunItem = db.prepare(
        `INSERT INTO kol_generation_run_items (
          id, run_id, campaign_kol_item_id, display_order, score, explanation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      baseItems.forEach((item, index) => {
        insertRunItem.run(
          randomUUID(),
          runId,
          item.id,
          index + 1,
          0,
          JSON.stringify({ reset: true, source: "seed_pool", baseDisplayOrder: Number(item.display_order ?? index + 1) }),
          timestamp
        );
      });
      db.prepare("UPDATE campaigns SET review_round = ?, last_updated_at = ? WHERE id = ?").run(versionLabel, timestamp, input.campaignId);
    } else {
      db.prepare("UPDATE campaigns SET last_updated_at = ? WHERE id = ?").run(timestamp, input.campaignId);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getCampaignBoard(db, input.campaignId, input.actorRole);
}

export function getGenerationRuns(db: DatabaseSync, campaignId: string) {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  return db
    .prepare(
      `SELECT r.*, COUNT(i.id) AS item_count
      FROM kol_generation_runs r
      LEFT JOIN kol_generation_run_items i ON i.run_id = r.id
      WHERE r.campaign_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC, r.rowid DESC`
    )
    .all(campaignId)
    .map(normalizeGenerationRun);
}

export function getGenerationRunWithItems(db: DatabaseSync, runId: string) {
  const runRow = db
    .prepare(
      `SELECT r.*, COUNT(i.id) AS item_count
      FROM kol_generation_runs r
      LEFT JOIN kol_generation_run_items i ON i.run_id = r.id
      WHERE r.id = ?
      GROUP BY r.id`
    )
    .get(runId);
  if (!runRow) throw new ApiError(404, "未找到 KOL 生成版本。");

  const run = normalizeGenerationRun(runRow);
  const items = db
    .prepare(
      `SELECT * FROM kol_generation_run_items
      WHERE run_id = ?
      ORDER BY display_order ASC`
    )
    .all(runId)
    .map(normalizeGenerationRunItem);

  return { ...run, items };
}

export function getLatestGenerationRun(db: DatabaseSync, campaignId: string) {
  const row = db
    .prepare(
      `SELECT r.*, COUNT(i.id) AS item_count
      FROM kol_generation_runs r
      LEFT JOIN kol_generation_run_items i ON i.run_id = r.id
      WHERE r.campaign_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC, r.rowid DESC
      LIMIT 1`
    )
    .get(campaignId);
  return row ? normalizeGenerationRun(row) : null;
}

export function getCampaignDecisionHistory(db: DatabaseSync, campaignId: string, actorRole: ActorRole = "client") {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const visibilityClause = actorRole === "client" ? "AND e.visibility <> 'agency_only'" : "";
  const rows = db
    .prepare(
      `SELECT
        e.*,
        p.name AS kol_name,
        p.handle AS kol_handle,
        p.profile_url AS kol_profile_url,
        p.avatar_url AS kol_avatar_url,
        COALESCE(s.current_status, i.status_current, 'pending') AS current_status
      FROM kol_selection_events e
      LEFT JOIN campaign_kol_items i ON i.id = e.campaign_kol_item_id
      LEFT JOIN kol_profiles p ON p.id = e.kol_id
      LEFT JOIN kol_selection_current_state s ON s.campaign_kol_item_id = e.campaign_kol_item_id
      WHERE e.campaign_id = ?
        AND e.to_status IN ('approved', 'rejected')
        ${visibilityClause}
      ORDER BY e.created_at DESC`
    )
    .all(campaignId)
    .map(normalizeDecisionHistoryEntry);

  return {
    generatedAt: nowIso(),
    approved: rows.filter((event) => event.toStatus === "approved"),
    rejected: rows.filter((event) => event.toStatus === "rejected")
  };
}

export function getCampaignEvents(db: DatabaseSync, campaignId: string) {
  return db
    .prepare(
      `SELECT e.*, p.name AS kol_name, p.handle AS kol_handle, p.platform AS kol_platform
      FROM kol_selection_events e
      LEFT JOIN kol_profiles p ON p.id = e.kol_id
      WHERE e.campaign_id = ?
      ORDER BY e.created_at ASC`
    )
    .all(campaignId)
    .map((row) => ({
      ...normalizeEvent(row),
      kolName: row.kol_name ?? null,
      kolHandle: row.kol_handle ?? null,
      kolPlatform: row.kol_platform ?? null
    }));
}

export function getRootKolEdges(db: DatabaseSync, campaignId: string) {
  return db
    .prepare(
      `SELECT
        e.*,
        p.name AS kol_name,
        p.platform AS kol_platform,
        p.followers AS kol_followers,
        p.content_category AS kol_content_category,
        i.display_order AS kol_display_order
      FROM root_kol_edges e
      JOIN campaign_kol_items i ON i.id = e.campaign_kol_item_id
      JOIN kol_profiles p ON p.id = e.kol_id
      WHERE e.campaign_id = ?
      ORDER BY e.root_group ASC, e.root_name ASC, e.confidence DESC, i.display_order ASC`
    )
    .all(campaignId)
    .map(normalizeRootKolEdge);
}

export function getRootKolImpact(db: DatabaseSync, campaignId: string) {
  const edges = getRootKolEdges(db, campaignId);
  const edgesByRoot = new Map<string, typeof edges>();
  const edgesByItem = new Map<string, typeof edges>();

  for (const edge of edges) {
    const rootKey = edge.rootHandle.toLowerCase();
    if (!edgesByRoot.has(rootKey)) edgesByRoot.set(rootKey, []);
    edgesByRoot.get(rootKey)?.push(edge);
    if (!edgesByItem.has(edge.campaignKolItemId)) edgesByItem.set(edge.campaignKolItemId, []);
    edgesByItem.get(edge.campaignKolItemId)?.push(edge);
  }

  const roots = Array.from(edgesByRoot.values())
    .map((rootEdges) => {
      const first = rootEdges[0];
      const items = dedupeBy(rootEdges, (edge) => edge.campaignKolItemId).map((edge) => {
        const itemEdges = edgesByItem.get(edge.campaignKolItemId) ?? [];
        const rootEdgesForItem = itemEdges.filter((candidate) => candidate.rootHandle === edge.rootHandle);
        const maxRootConfidence = Math.max(...rootEdgesForItem.map((candidate) => candidate.confidence));
        const hasOtherStrongSupport = itemEdges.some((candidate) => candidate.rootHandle !== edge.rootHandle && candidate.confidence >= 0.5);
        const hardRemoveIfRejected = maxRootConfidence >= 0.7 && !hasOtherStrongSupport;
        return {
          campaignKolItemId: edge.campaignKolItemId,
          kolId: edge.kolId,
          kolHandle: edge.kolHandle,
          kolName: edge.kolName,
          kolDisplayOrder: edge.kolDisplayOrder,
          maxRootConfidence,
          supportCount: itemEdges.length,
          strongSupportCount: itemEdges.filter((candidate) => candidate.confidence >= 0.5).length,
          hardRemoveIfRejected,
          downgradeIfRejected: !hardRemoveIfRejected,
          evidence: edge.evidence,
          edgeSources: rootEdgesForItem.map((candidate) => ({
            source: candidate.edgeSource,
            type: candidate.edgeType,
            confidence: candidate.confidence
          }))
        };
      });

      return {
        rootHandle: first?.rootHandle ?? "",
        rootName: first?.rootName ?? "",
        rootGroup: first?.rootGroup ?? "",
        matchedKolCount: items.length,
        hardRemoveIfRejected: items.filter((item) => item.hardRemoveIfRejected),
        downgradeIfRejected: items.filter((item) => item.downgradeIfRejected)
      };
    })
    .sort((a, b) => a.rootGroup.localeCompare(b.rootGroup) || a.rootName.localeCompare(b.rootName));

  return {
    campaignId,
    summary: {
      edgeCount: edges.length,
      rootCount: roots.length,
      kolCount: new Set(edges.map((edge) => edge.campaignKolItemId)).size,
      explicitEdgeCount: edges.filter((edge) => edge.edgeType === "explicit_signal").length,
      archetypeEdgeCount: edges.filter((edge) => edge.edgeType === "signal_archetype").length,
      inferredEdgeCount: edges.filter((edge) => edge.edgeType === "lane_inference").length
    },
    roots
  };
}

export function getCurrentState(db: DatabaseSync, itemId: string) {
  const state = db.prepare("SELECT * FROM kol_selection_current_state WHERE campaign_kol_item_id = ?").get(itemId);
  if (!state) {
    const item = db.prepare("SELECT * FROM campaign_kol_items WHERE id = ?").get(itemId);
    if (!item) throw new ApiError(404, "未找到该候选账号。");
    return {
      id: null,
      currentStatus: item.status_current ?? "pending",
      currentDecision: item.status_current ?? "pending",
      currentReasonTags: [],
      currentNote: "",
      lastEventId: null,
      lastActorId: null,
      lastActorRole: null,
      lastUpdatedAt: item.updated_at
    };
  }
  return normalizeCurrentState(state);
}

export function exportSelection(db: DatabaseSync, campaignId: string, format: "json" | "csv") {
  const board = getCampaignBoard(db, campaignId, "agency");
  const events = getCampaignEvents(db, campaignId);
  const clientActionLog = getClientActionEvents(db, campaignId, { limit: 1000 });
  const rootAudienceSnapshots = getRootAudienceSnapshots(db, campaignId);
  const rootKolImpact = getRootKolImpact(db, campaignId);
  const generationRuns = getGenerationRuns(db, campaignId).map((run) => getGenerationRunWithItems(db, run.id));
  const generatedAt = nowIso();

  const payload = {
    generatedAt,
    campaign: board.campaign,
    activeGenerationRun: board.activeGenerationRun,
    rootAudienceSnapshots,
    generationRuns,
    rootKolImpact,
    approved: board.items.filter((item) => item.currentState.currentStatus === "approved"),
    rejected: board.items.filter((item) => item.currentState.currentStatus === "rejected"),
    question: board.items.filter((item) => item.currentState.currentStatus === "question"),
    hold: board.items.filter((item) => item.currentState.currentStatus === "hold"),
    pending: board.items.filter((item) => item.currentState.currentStatus === "pending"),
    fullDecisionLog: events,
    clientActionLog,
    rootAudienceLog: clientActionLog.filter((event) => event.surface === "root_audience")
  };

  if (format === "json") return payload;

  const rows = [
    [
      "section",
      "status",
      "name",
      "handle",
      "platform",
      "followers",
      "category",
      "price",
      "contact_status",
      "reason_tags",
      "note",
      "recommended_angle",
      "profile_url"
    ]
  ];

  for (const section of ["approved", "rejected", "question", "hold", "pending"] as const) {
    payload[section].forEach((item) => {
      rows.push([
        section,
        item.currentState.currentStatus,
        item.kol.name,
        item.kol.handle,
        item.kol.platform,
        String(item.kol.followers),
        item.kol.contentCategory,
        item.estimatedPrice,
        item.contactStatus,
        item.currentState.currentReasonTags.join("; "),
        item.currentState.currentNote,
        item.recommendedAngle,
        item.kol.profileUrl
      ]);
    });
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function lockSelection(db: DatabaseSync, campaignId: string, actorId: string, actorRole: ActorRole) {
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");
  if (actorRole === "client") throw new ApiError(403, "当前客户评审版不能锁定最终版本。");

  const timestamp = nowIso();
  const eventId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE campaigns SET locked_at = ?, last_updated_at = ? WHERE id = ?").run(timestamp, timestamp, campaignId);
    db
      .prepare(
        `INSERT INTO kol_selection_events (
          id, client_id, campaign_id, campaign_kol_item_id, kol_id, actor_id, actor_role, event_type,
          from_status, to_status, decision, reason_tags, note, visibility, client_request_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        campaign.client_id,
        campaignId,
        null,
        null,
        actorId,
        actorRole,
        "locked",
        null,
        "locked",
        "locked",
        JSON.stringify([]),
        "Selection version locked for agency execution.",
        "agency_only",
        `lock-${campaignId}-${timestamp}`,
        JSON.stringify({ lockedAt: timestamp }),
        timestamp
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getCampaignBoard(db, campaignId, actorRole);
}

export function resetCampaignReviewState(db: DatabaseSync, campaignId: string) {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const before = {
    totalItems: Number(db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    discoveredItems: Number(
      db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ? AND created_by = 'twitter241_discovery'").get(campaignId)?.count ?? 0
    ),
    currentStates: Number(db.prepare("SELECT COUNT(*) AS count FROM kol_selection_current_state WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    generationRuns: Number(db.prepare("SELECT COUNT(*) AS count FROM kol_generation_runs WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    rootSnapshots: Number(db.prepare("SELECT COUNT(*) AS count FROM root_audience_snapshots WHERE campaign_id = ?").get(campaignId)?.count ?? 0)
  };
  const timestamp = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    db
      .prepare(
        `DELETE FROM kol_generation_run_items
        WHERE run_id IN (SELECT id FROM kol_generation_runs WHERE campaign_id = ?)`
      )
      .run(campaignId);
    db.prepare("DELETE FROM kol_generation_runs WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM root_audience_snapshots WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM kol_selection_followups WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM kol_feedback_learning_events WHERE campaign_id = ?").run(campaignId);
    db.prepare("DELETE FROM kol_selection_current_state WHERE campaign_id = ?").run(campaignId);
    db
      .prepare(
        `UPDATE kol_selection_events
        SET campaign_kol_item_id = NULL, kol_id = NULL
        WHERE campaign_id = ?
          AND campaign_kol_item_id IN (
            SELECT id FROM campaign_kol_items WHERE campaign_id = ? AND created_by = 'twitter241_discovery'
          )`
      )
      .run(campaignId, campaignId);
    db.prepare("DELETE FROM campaign_kol_items WHERE campaign_id = ? AND created_by = 'twitter241_discovery'").run(campaignId);
    db
      .prepare(
        `UPDATE campaign_kol_items
        SET status_current = 'pending', updated_at = ?
        WHERE campaign_id = ?`
      )
      .run(timestamp, campaignId);
    db.prepare("UPDATE campaigns SET locked_at = NULL, last_updated_at = ? WHERE id = ?").run(timestamp, campaignId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const after = {
    totalItems: Number(db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    discoveredItems: Number(
      db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ? AND created_by = 'twitter241_discovery'").get(campaignId)?.count ?? 0
    ),
    currentStates: Number(db.prepare("SELECT COUNT(*) AS count FROM kol_selection_current_state WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    generationRuns: Number(db.prepare("SELECT COUNT(*) AS count FROM kol_generation_runs WHERE campaign_id = ?").get(campaignId)?.count ?? 0),
    rootSnapshots: Number(db.prepare("SELECT COUNT(*) AS count FROM root_audience_snapshots WHERE campaign_id = ?").get(campaignId)?.count ?? 0)
  };

  return { campaignId, resetAt: timestamp, before, after };
}

function normalizeCampaign(row: Row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(row.client_name),
    clientTier: String(row.client_tier),
    name: String(row.name),
    reviewRound: String(row.review_round),
    objective: String(row.objective),
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    lastUpdatedAt: String(row.last_updated_at),
    createdAt: String(row.created_at)
  };
}

function normalizeBoardItem(row: Row, actorRole: ActorRole) {
  const currentStatus = String(row.current_status ?? row.status_current ?? "pending");
  assertStatus(currentStatus);
  const baseMetadata = readJsonObject(row.item_metadata);
  const generationExplanation = readJsonObject(row.generation_explanation);
  const itemMetadata = row.generation_run_id
    ? {
        ...baseMetadata,
        generation: {
          runId: String(row.generation_run_id),
          score: Number(row.generation_score ?? 0),
          explanation: generationExplanation,
          baseDisplayOrder: Number(row.base_display_order ?? row.display_order ?? 0)
        }
      }
    : baseMetadata;

  return {
    id: String(row.item_id),
    clientId: String(row.item_client_id),
    campaignId: String(row.item_campaign_id),
    displayOrder: Number(row.display_order ?? 0),
    clientFacingNote: String(row.client_facing_note ?? ""),
    agencyInternalNote: actorRole === "agency" || actorRole === "admin" ? String(row.agency_internal_note ?? "") : null,
    whyIncluded: String(row.why_included ?? ""),
    recommendedAngle: String(row.recommended_angle ?? ""),
    estimatedPrice: String(row.estimated_price ?? ""),
    contactStatus: String(row.contact_status ?? ""),
    riskTags: readJsonArray(row.risk_tags),
    metadata: itemMetadata,
    currentState: {
      id: row.state_id ? String(row.state_id) : null,
      currentStatus,
      currentDecision: String(row.current_decision ?? currentStatus),
      currentReasonTags: readJsonArray(row.current_reason_tags),
      currentNote: String(row.current_note ?? ""),
      lastEventId: row.last_event_id ? String(row.last_event_id) : null,
      lastActorId: row.last_actor_id ? String(row.last_actor_id) : null,
      lastActorRole: row.last_actor_role ? String(row.last_actor_role) : null,
      lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : String(row.item_updated_at)
    },
    kol: {
      id: String(row.kol_id),
      name: String(row.kol_name),
      handle: String(row.handle),
      platform: String(row.platform),
      profileUrl: String(row.profile_url),
      avatarUrl: String(row.avatar_url),
      bio: String(row.bio),
      followers: Number(row.followers ?? 0),
      region: String(row.region),
      language: String(row.language),
      contentCategory: String(row.content_category),
      audienceSummary: String(row.audience_summary),
      metadata: readJsonObject(row.kol_metadata)
    }
  };
}

function normalizeCurrentState(row: Row) {
  return {
    id: String(row.id),
    currentStatus: String(row.current_status),
    currentDecision: String(row.current_decision),
    currentReasonTags: readJsonArray(row.current_reason_tags),
    currentNote: String(row.current_note ?? ""),
    lastEventId: row.last_event_id ? String(row.last_event_id) : null,
    lastActorId: String(row.last_actor_id),
    lastActorRole: String(row.last_actor_role),
    lastUpdatedAt: String(row.last_updated_at)
  };
}

function normalizeEvent(row: Row | undefined) {
  if (!row) throw new ApiError(404, "未找到评审记录。");
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    campaignKolItemId: row.campaign_kol_item_id ? String(row.campaign_kol_item_id) : null,
    kolId: row.kol_id ? String(row.kol_id) : null,
    actorId: String(row.actor_id),
    actorRole: String(row.actor_role),
    eventType: String(row.event_type),
    fromStatus: row.from_status ? String(row.from_status) : null,
    toStatus: row.to_status ? String(row.to_status) : null,
    decision: row.decision ? String(row.decision) : null,
    reasonTags: readJsonArray(row.reason_tags),
    note: String(row.note ?? ""),
    visibility: String(row.visibility),
    clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
    metadata: readJsonObject(row.metadata),
    createdAt: String(row.created_at)
  };
}

function normalizeClientActionEvent(row: Row | undefined) {
  if (!row) throw new ApiError(404, "未找到行为记录。");
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    surface: String(row.surface),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    actionType: String(row.action_type),
    actorId: String(row.actor_id),
    actorRole: String(row.actor_role),
    fromValue: row.from_value ? String(row.from_value) : null,
    toValue: row.to_value ? String(row.to_value) : null,
    reasonTags: readJsonArray(row.reason_tags),
    note: String(row.note ?? ""),
    metadata: readJsonObject(row.metadata),
    clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
    createdAt: String(row.created_at)
  };
}

function normalizeDecisionHistoryEntry(row: Row) {
  const currentStatus = String(row.current_status ?? "pending");
  assertStatus(currentStatus);

  return {
    ...normalizeEvent(row),
    kolName: row.kol_name ? String(row.kol_name) : null,
    kolHandle: row.kol_handle ? String(row.kol_handle) : null,
    kolProfileUrl: row.kol_profile_url ? String(row.kol_profile_url) : null,
    kolAvatarUrl: row.kol_avatar_url ? String(row.kol_avatar_url) : null,
    currentStatus
  };
}

function normalizeRootKolEdge(row: Row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    rootHandle: String(row.root_handle),
    rootName: String(row.root_name),
    rootGroup: String(row.root_group),
    campaignKolItemId: String(row.campaign_kol_item_id),
    kolId: String(row.kol_id),
    kolHandle: String(row.kol_handle),
    kolName: String(row.kol_name ?? ""),
    kolPlatform: String(row.kol_platform ?? ""),
    kolFollowers: Number(row.kol_followers ?? 0),
    kolContentCategory: String(row.kol_content_category ?? ""),
    kolDisplayOrder: Number(row.kol_display_order ?? 0),
    edgeType: String(row.edge_type),
    edgeSource: String(row.edge_source),
    confidence: Number(row.confidence ?? 0),
    evidence: String(row.evidence ?? ""),
    metadata: readJsonObject(row.metadata),
    fetchedAt: row.fetched_at ? String(row.fetched_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function normalizeRootAudienceSnapshot(row: Row | undefined) {
  if (!row) throw new ApiError(404, "未找到目标人群确认快照。");
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    round: Number(row.round ?? 1),
    snapshot: readJsonObject(row.snapshot_json),
    createdBy: String(row.created_by),
    clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
    createdAt: String(row.created_at)
  };
}

function normalizeGenerationRun(row: Row | undefined) {
  if (!row) throw new ApiError(404, "未找到 KOL 生成版本。");
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    sourceSnapshotId: String(row.source_snapshot_id),
    status: String(row.status),
    versionLabel: String(row.version_label),
    triggerActorId: String(row.trigger_actor_id),
    triggerActorRole: String(row.trigger_actor_role),
    triggerReason: String(row.trigger_reason),
    metadata: readJsonObject(row.metadata_json),
    clientRequestId: row.client_request_id ? String(row.client_request_id) : null,
    itemCount: Number(row.item_count ?? 0),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

function normalizeGenerationRunItem(row: Row | undefined) {
  if (!row) throw new ApiError(404, "未找到 KOL 生成结果。");
  return {
    id: String(row.id),
    runId: String(row.run_id),
    campaignKolItemId: String(row.campaign_kol_item_id),
    displayOrder: Number(row.display_order ?? 0),
    score: Number(row.score ?? 0),
    explanation: readJsonObject(row.explanation_json),
    createdAt: String(row.created_at)
  };
}

function upsertDiscoveredCandidates(
  db: DatabaseSync,
  input: {
    campaignId: string;
    clientId: string;
    runId: string;
    timestamp: string;
    candidates: DiscoveredKolCandidateInput[];
  }
) {
  if (input.candidates.length === 0) return { received: 0, insertedProfiles: 0, insertedItems: 0, reusedItems: 0, skipped: 0 };

  const insertProfile = db.prepare(
    `INSERT INTO kol_profiles (
      id, name, handle, platform, profile_url, avatar_url, bio, followers, region, language,
      content_category, email, contact_url, audience_summary, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateProfile = db.prepare(
    `UPDATE kol_profiles
      SET name = ?, profile_url = ?, avatar_url = ?, bio = ?, followers = ?, content_category = ?,
        audience_summary = ?, metadata = ?, updated_at = ?
      WHERE id = ?`
  );
  const insertItem = db.prepare(
    `INSERT INTO campaign_kol_items (
      id, client_id, campaign_id, kol_id, display_order, status_current, client_facing_note,
      agency_internal_note, why_included, recommended_angle, estimated_price, contact_status,
      risk_tags, metadata, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateItem = db.prepare("UPDATE campaign_kol_items SET metadata = ?, updated_at = ? WHERE id = ?");
  const maxOrder = db.prepare("SELECT COALESCE(MAX(display_order), 0) AS max_order FROM campaign_kol_items WHERE campaign_id = ?").get(input.campaignId);
  let nextOrder = Number(maxOrder?.max_order ?? 0) + 1;
  let insertedProfiles = 0;
  let insertedItems = 0;
  let reusedItems = 0;
  let skipped = 0;
  const seenHandles = new Set<string>();

  for (const candidate of input.candidates) {
    const handle = normalizeHandle(candidate.handle);
    if (!handle || seenHandles.has(handle)) {
      skipped += 1;
      continue;
    }
    seenHandles.add(handle);

    const profileMetadata = {
      audienceFit: Math.max(55, Math.round(Number(candidate.scoreHint ?? 60))),
      discovery: {
        runId: input.runId,
        source: candidate.source ?? "twitter241",
        sourceRootHandle: candidate.sourceRootHandle ?? null,
        scoreHint: Number(candidate.scoreHint ?? 0),
        discoveredAt: input.timestamp,
        ...(candidate.metadata ?? {})
      }
    };
    const name = candidate.name.trim() || handle;
    const profileUrl = candidate.profileUrl?.trim() || `https://x.com/${handle}`;
    const avatarUrl = candidate.avatarUrl?.trim() || "";
    const bio = candidate.bio?.trim() || "";
    const contentCategory = candidate.contentCategory?.trim() || inferContentCategory(`${name} ${bio}`);
    const audienceSummary = candidate.audienceSummary?.trim() || inferAudienceSummary(candidate);

    let profile = db
      .prepare("SELECT * FROM kol_profiles WHERE lower(handle) = ? AND lower(platform) IN ('x', 'twitter', 'x/twitter') ORDER BY updated_at DESC LIMIT 1")
      .get(handle);

    if (profile) {
      const mergedMetadata = {
        ...readJsonObject(profile.metadata),
        ...profileMetadata
      };
      updateProfile.run(
        name,
        profileUrl,
        avatarUrl || String(profile.avatar_url ?? ""),
        bio || String(profile.bio ?? ""),
        Math.max(Number(candidate.followers ?? 0), Number(profile.followers ?? 0)),
        contentCategory,
        audienceSummary || String(profile.audience_summary ?? ""),
        JSON.stringify(mergedMetadata),
        input.timestamp,
        String(profile.id)
      );
    } else {
      const profileId = uniqueEntityId(db, "kol_profiles", `kol-${slugify(handle)}`);
      insertProfile.run(
        profileId,
        name,
        handle,
        candidate.platform?.trim() || "X",
        profileUrl,
        avatarUrl,
        bio,
        Math.max(0, Math.floor(Number(candidate.followers ?? 0))),
        candidate.region?.trim() || "Global",
        candidate.language?.trim() || "EN",
        contentCategory,
        null,
        null,
        audienceSummary,
        JSON.stringify(profileMetadata),
        input.timestamp,
        input.timestamp
      );
      insertedProfiles += 1;
      profile = { id: profileId };
    }

    const existingItem = db
      .prepare(
        `SELECT i.*
        FROM campaign_kol_items i
        JOIN kol_profiles p ON p.id = i.kol_id
        WHERE i.campaign_id = ? AND lower(p.handle) = ?
        ORDER BY i.updated_at DESC
        LIMIT 1`
      )
      .get(input.campaignId, handle);
    const itemMetadata = {
      discovery: {
        runId: input.runId,
        source: candidate.source ?? "twitter241",
        sourceRootHandle: candidate.sourceRootHandle ?? null,
        scoreHint: Number(candidate.scoreHint ?? 0),
        discoveredAt: input.timestamp,
        ...(candidate.metadata ?? {})
      }
    };

    if (existingItem) {
      updateItem.run(JSON.stringify({ ...readJsonObject(existingItem.metadata), ...itemMetadata }), input.timestamp, String(existingItem.id));
      reusedItems += 1;
      continue;
    }

    const itemId = uniqueEntityId(db, "campaign_kol_items", `item-${slugify(input.campaignId)}-${slugify(handle)}`);
    insertItem.run(
      itemId,
      input.clientId,
      input.campaignId,
      String(profile.id),
      nextOrder,
      "pending",
      candidate.audienceSummary?.trim() || `从客户确认的目标人群重新召回：${name} 与本轮 root audience 有网络或语义关联。`,
      `Twitter241 discovery candidate. Source root: ${candidate.sourceRootHandle ?? "search"}.`,
      candidate.whyIncluded?.trim() || `通过 Twitter241 从 ${candidate.sourceRootHandle ?? "root audience query"} 相关网络重新召回。`,
      candidate.recommendedAngle?.trim() || inferRecommendedAngle(candidate),
      "待确认",
      candidate.contactStatus?.trim() || inferContactStatus(`${name} ${bio}`),
      JSON.stringify(candidate.riskTags ?? []),
      JSON.stringify(itemMetadata),
      "twitter241_discovery",
      input.timestamp,
      input.timestamp
    );
    insertedItems += 1;
    nextOrder += 1;
  }

  return { received: input.candidates.length, insertedProfiles, insertedItems, reusedItems, skipped };
}

function rankItemsForSnapshot(db: DatabaseSync, campaignId: string, snapshot: Record<string, unknown>, limit?: number, options: { includeDiscovered?: boolean } = {}) {
  const decisionValues = readSnapshotDecisionValues(snapshot);
  const groupSignals = readSnapshotGroupSignals(snapshot);
  const approvedRoots = decisionValues.filter((decision) => decision.status === "approved");
  const rejectedRoots = decisionValues.filter((decision) => decision.status === "rejected");
  const questionRoots = decisionValues.filter((decision) => decision.status === "question");
  const rootAudienceHandles = new Set(decisionValues.map((decision) => normalizeHandle(decision.handle)).filter(Boolean));
  const rootGraphFilter = buildRootGraphFilter(db, campaignId, rejectedRoots);

  const rows = db
    .prepare(
      `SELECT
        i.id AS item_id,
        i.display_order,
        i.contact_status,
        i.risk_tags,
        i.why_included,
        i.recommended_angle,
        i.metadata AS item_metadata,
        p.followers,
        p.handle,
        p.content_category,
        p.audience_summary,
        p.metadata AS kol_metadata
      FROM campaign_kol_items i
      JOIN kol_profiles p ON p.id = i.kol_id
      WHERE i.campaign_id = ?
        ${options.includeDiscovered ? "" : "AND COALESCE(i.created_by, '') <> 'twitter241_discovery'"}`
    )
    .all(campaignId);

  return rows
    .flatMap((row) => {
      const itemId = String(row.item_id);
      if (rootAudienceHandles.has(normalizeHandle(String(row.handle ?? "")))) return [];
      if (rootGraphFilter.hardRemoveItemIds.has(itemId)) return [];
      const kolMetadata = readJsonObject(row.kol_metadata);
      const riskTags = readJsonArray(row.risk_tags);
      const audienceFit = Number(kolMetadata.audienceFit ?? 0);
      const text = [
        row.why_included,
        row.recommended_angle,
        row.contact_status,
        row.content_category,
        row.audience_summary,
        row.item_metadata,
        kolMetadata.rootVisibilitySignal
      ]
        .join(" ")
        .toLowerCase();

      const approvedBoost = approvedRoots.reduce((sum, root) => sum + rootMatchScore(text, root), 0);
      const rejectedMatches = rejectedRoots
        .map((root) => ({ root, score: rootMatchScore(text, root) }))
        .filter((match) => match.score >= 5);
      if (rejectedMatches.length > 0) return [];
      const rejectedPenalty = rejectedRoots.reduce((sum, root) => sum + rootMatchScore(text, root) * 0.7, 0);
      const questionBoost = questionRoots.reduce((sum, root) => sum + rootMatchScore(text, root) * 0.25, 0);
      const groupBoost = groupSignals.reduce((sum, group) => sum + groupApprovalBoost(text, group), 0);
      const groupPenalty = groupSignals.reduce((sum, group) => sum + groupRejectionPenalty(text, group), 0);
      const contactBoost = contactBoostFor(String(row.contact_status ?? ""));
      const discoveryBoost = discoveryBoostFor(readJsonObject(row.item_metadata), kolMetadata);
      const riskPenalty = riskTags.filter((tag) => tag !== "none").length * 2;
      const rootGraphPenalty = rootGraphFilter.downgradeItemIds.has(itemId) ? 8 : 0;
      const score =
        Math.round(
          (audienceFit +
            approvedBoost +
            questionBoost +
            groupBoost +
            contactBoost +
            discoveryBoost -
            rejectedPenalty -
            groupPenalty -
            riskPenalty -
            rootGraphPenalty) *
            100
        ) /
        100;

      return {
        itemId,
        score,
        explanation: {
          baseAudienceFit: audienceFit,
          approvedRootCount: approvedRoots.length,
          rejectedRootCount: rejectedRoots.length,
          questionRootCount: questionRoots.length,
          approvedBoost,
          rejectedPenalty,
          questionBoost,
          groupBoost,
          groupPenalty,
          contactBoost,
          discoveryBoost,
          riskPenalty,
          rootGraphPenalty,
          originalDisplayOrder: Number(row.display_order ?? 0)
        }
      };
    })
    .sort((a, b) => b.score - a.score || Number(a.explanation.originalDisplayOrder) - Number(b.explanation.originalDisplayOrder))
    .slice(0, limit);
}

function buildRootGraphFilter(db: DatabaseSync, campaignId: string, rejectedRoots: SnapshotRootDecision[]) {
  const rejectedHandles = new Set(rejectedRoots.map((root) => normalizeHandle(root.handle)).filter(Boolean));
  const hardRemoveItemIds = new Set<string>();
  const downgradeItemIds = new Set<string>();
  if (rejectedHandles.size === 0) return { hardRemoveItemIds, downgradeItemIds };

  const edges = getRootKolEdges(db, campaignId);
  const edgesByItem = new Map<string, typeof edges>();
  for (const edge of edges) {
    const list = edgesByItem.get(edge.campaignKolItemId) ?? [];
    list.push(edge);
    edgesByItem.set(edge.campaignKolItemId, list);
  }

  for (const [itemId, itemEdges] of edgesByItem.entries()) {
    const rejectedRootConfidence = Math.max(
      0,
      ...itemEdges.filter((edge) => rejectedHandles.has(normalizeHandle(edge.rootHandle))).map((edge) => edge.confidence)
    );
    if (rejectedRootConfidence < 0.7) continue;

    const hasOtherStrongSupport = itemEdges.some((edge) => !rejectedHandles.has(normalizeHandle(edge.rootHandle)) && edge.confidence >= 0.5);
    if (hasOtherStrongSupport) {
      downgradeItemIds.add(itemId);
    } else {
      hardRemoveItemIds.add(itemId);
    }
  }

  return { hardRemoveItemIds, downgradeItemIds };
}

type SnapshotRootDecision = {
  handle: string;
  status: string;
  reason: string;
  note: string;
  name: string;
  role: string;
  groupName: string;
};

function readSnapshotDecisionValues(snapshot: Record<string, unknown>): SnapshotRootDecision[] {
  const decisions = snapshot.decisions && typeof snapshot.decisions === "object" && !Array.isArray(snapshot.decisions) ? snapshot.decisions : {};
  const decisionRecords = decisions as Record<string, unknown>;
  const roots = new Map<string, SnapshotRootDecision>();

  if (Array.isArray(snapshot.groups)) {
    for (const group of snapshot.groups) {
      const groupRecord = group && typeof group === "object" && !Array.isArray(group) ? (group as Record<string, unknown>) : {};
      const groupName = String(groupRecord.name ?? "");
      const people = Array.isArray(groupRecord.people) ? groupRecord.people : [];
      for (const person of people) {
        const personRecord = person && typeof person === "object" && !Array.isArray(person) ? (person as Record<string, unknown>) : {};
        const rawHandle = String(personRecord.handle ?? "");
        const handle = normalizeHandle(rawHandle);
        if (!handle) continue;
        const decision = readJsonObject(decisionRecords[rawHandle] ?? decisionRecords[`@${handle}`] ?? decisionRecords[handle]);
        roots.set(handle, {
          handle: `@${handle}`,
          status: String(decision.status ?? personRecord.status ?? "pending"),
          reason: decision.reason ? String(decision.reason) : "",
          note: decision.note ? String(decision.note) : "",
          name: String(personRecord.name ?? ""),
          role: String(personRecord.role ?? ""),
          groupName
        });
      }
    }
  }

  for (const [handle, value] of Object.entries(decisionRecords)) {
    const data = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const normalized = normalizeHandle(handle);
    if (!normalized) continue;
    const existing = roots.get(normalized);
    roots.set(normalized, {
      handle: existing?.handle ?? `@${normalized}`,
      status: String(data.status ?? "pending"),
      reason: data.reason ? String(data.reason) : "",
      note: data.note ? String(data.note) : "",
      name: existing?.name ?? "",
      role: existing?.role ?? "",
      groupName: existing?.groupName ?? ""
    });
  }

  return Array.from(roots.values());
}

function readSnapshotGroupSignals(snapshot: Record<string, unknown>) {
  if (!Array.isArray(snapshot.groups)) return [];
  const decisions = snapshot.decisions && typeof snapshot.decisions === "object" && !Array.isArray(snapshot.decisions) ? (snapshot.decisions as Record<string, unknown>) : {};
  return snapshot.groups.map((group) => {
    const groupRecord = group && typeof group === "object" && !Array.isArray(group) ? (group as Record<string, unknown>) : {};
    const people = Array.isArray(groupRecord.people) ? groupRecord.people : [];
    const counts = { total: 0, approved: 0, rejected: 0, question: 0 };
    for (const person of people) {
      const personRecord = person && typeof person === "object" && !Array.isArray(person) ? (person as Record<string, unknown>) : {};
      const rawHandle = String(personRecord.handle ?? "");
      const handle = normalizeHandle(rawHandle);
      const decision = readJsonObject(decisions[rawHandle] ?? decisions[`@${handle}`] ?? decisions[handle]);
      const status = String(decision.status ?? personRecord.status ?? "pending");
      counts.total += 1;
      if (status === "approved") counts.approved += 1;
      if (status === "rejected") counts.rejected += 1;
      if (status === "question") counts.question += 1;
    }
    return {
      name: String(groupRecord.name ?? ""),
      ...counts
    };
  });
}

function rootMatchScore(text: string, root: SnapshotRootDecision) {
  const handle = root.handle.replace(/^@/, "").toLowerCase();
  const reason = root.reason.toLowerCase();
  const note = root.note.toLowerCase();
  const name = root.name.toLowerCase();
  const nameTerms = name
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4);
  let score = 0;
  if (handle && text.includes(handle)) score += 8;
  if (name && text.includes(name)) score += 10;
  for (const term of nameTerms) {
    if (text.includes(term)) score += 5;
  }
  if (reason && text.includes(reason)) score += 3;
  if (note && text.includes(note)) score += 2;
  if (/vc|investor|fund|founder|a16z|venture/.test(text) && /vc|投资|investor|founder/i.test(`${reason} ${note}`)) score += 2;
  if (/newsletter|podcast|media|creator/.test(text) && /媒体|newsletter|podcast|creator/i.test(`${reason} ${note}`)) score += 2;
  if (/research|technical|engineer|builder|agent/.test(text) && /技术|agent|builder|research/i.test(`${reason} ${note}`)) score += 2;
  return score;
}

function groupApprovalBoost(text: string, group: { name: string; total: number; approved: number; rejected: number; question: number }) {
  if (group.approved <= 0 && group.question <= 0) return 0;
  const match = rootGroupMatchScore(text, group.name);
  const approvedStrength = Math.min(group.approved, 4) * 0.85;
  const questionStrength = Math.min(group.question, 3) * 0.25;
  return Math.round(match * (approvedStrength + questionStrength) * 100) / 100;
}

function groupRejectionPenalty(text: string, group: { name: string; total: number; approved: number; rejected: number; question: number }) {
  if (group.rejected <= 0) return 0;
  const match = rootGroupMatchScore(text, group.name);
  return Math.round(match * Math.min(group.rejected, 4) * 0.55 * 100) / 100;
}

function rootGroupMatchScore(text: string, groupName: string) {
  const name = groupName.toLowerCase();
  if (/行业|超级|大佬|founder|leader/.test(name)) {
    let score = 0;
    if (/agent|builder|founder|product|frontier|broad ai|deep ai|research|technical/.test(text)) score += 2.6;
    if (/podcast|newsletter|media|discussion|education/.test(text)) score += 1.4;
    if (/commercial|creator|booking|sponsor|bd/.test(text)) score += 0.7;
    return score;
  }
  if (/vc|投资|venture|investor/.test(name)) {
    let score = 0;
    if (/vc|venture|investor|fund|founder|startup|business/.test(text)) score += 2.8;
    if (/newsletter|podcast|media|bd|warm|intro|commercial|sponsor/.test(text)) score += 1.8;
    if (/consumer|social|agent|ai-native/.test(text)) score += 0.7;
    return score;
  }
  if (/垂类|专家|核心|builder|expert/.test(name)) {
    let score = 0;
    if (/builder|engineer|technical|research|tools|education|creative|agent|product/.test(text)) score += 2.8;
    if (/tutorial|explain|demo|stack|workflow|developer/.test(text)) score += 1.4;
    if (/commercial|sponsor|bd/.test(text)) score += 0.5;
    return score;
  }
  return 0;
}

function contactBoostFor(contactStatus: string) {
  if (/明确|confirmed|contact|sponsor|commercial|booking|creator|可走/.test(contactStatus)) return 4;
  if (/需|待|unknown|验证|verification|required|bd/.test(contactStatus)) return 1;
  return 0;
}

function discoveryBoostFor(itemMetadata: Record<string, unknown>, kolMetadata: Record<string, unknown>) {
  const itemDiscovery = readJsonObject(itemMetadata.discovery);
  const profileDiscovery = readJsonObject(kolMetadata.discovery);
  const scoreHint = Math.max(Number(itemDiscovery.scoreHint ?? 0), Number(profileDiscovery.scoreHint ?? 0));
  if (!scoreHint) return 0;
  return Math.min(28, Math.max(8, scoreHint / 4));
}

function inferContentCategory(text: string) {
  const normalized = text.toLowerCase();
  if (/vc|venture|investor|fund|startup/.test(normalized)) return "VC / Founder Network";
  if (/newsletter|podcast|media|creator|youtube|writer/.test(normalized)) return "AI Media / Creator";
  if (/research|scientist|professor|paper|agi|alignment/.test(normalized)) return "AI Research";
  if (/agent|builder|engineer|developer|product|tool/.test(normalized)) return "Agent Builder";
  return "Broad AI";
}

function inferContactStatus(text: string) {
  const normalized = text.toLowerCase();
  if (/sponsor|partnership|booking|speaking|advertise|newsletter|podcast|media kit|dm/.test(normalized)) return "商业路径待验证";
  return "需 BD 验证";
}

function inferAudienceSummary(candidate: DiscoveredKolCandidateInput) {
  const source = candidate.sourceRootHandle ? `源自 ${candidate.sourceRootHandle} 的网络` : "源自目标人群搜索";
  const followers = Number(candidate.followers ?? 0);
  const scale = followers > 0 ? `；X ${formatCompactNumber(followers)} followers` : "";
  return `${source}${scale}，需补充商务可达性和内容质量验证。`;
}

function inferRecommendedAngle(candidate: DiscoveredKolCandidateInput) {
  const text = `${candidate.name} ${candidate.bio ?? ""} ${candidate.contentCategory ?? ""}`.toLowerCase();
  if (/vc|venture|investor|fund|startup/.test(text)) return "先验证投资/BD 路径，再判断是否适合 warm intro。";
  if (/newsletter|podcast|media|creator|youtube|writer/.test(text)) return "优先确认 creator/media 合作路径和历史商业内容。";
  if (/research|scientist|professor|paper|agi|alignment/.test(text)) return "用技术判断和 AI research 语境切入，避免普通投放话术。";
  return "先做账号质量和商业可达性验证，再进入正式合作沟通。";
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (value >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}K`;
  return String(value);
}

function normalizeHandle(value: string) {
  let handle = value.trim();
  if (!handle) return "";
  handle = handle.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  handle = handle.split(/[/?#]/)[0] ?? "";
  return handle.replace(/^@/, "").trim().toLowerCase();
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "candidate"
  );
}

function uniqueEntityId(db: DatabaseSync, table: "kol_profiles" | "campaign_kol_items", baseId: string) {
  let id = baseId;
  let suffix = 1;
  while (db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  return id;
}

function clampRunItemLimit(value: number) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), 250);
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
