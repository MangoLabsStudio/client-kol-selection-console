import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ApiError,
  selectionStatuses,
  type ActorRole,
  type CreateClientActionEventInput,
  type CreateKolGenerationRunInput,
  type CreateRootAudienceSnapshotInput,
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

  return {
    campaign: normalizeCampaign(campaign),
    summary: getCampaignSelectionSummary(db, campaignId),
    activeGenerationRun: activeRun,
    items: itemRows.map((row) => normalizeBoardItem(row, actorRole))
  };
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
  const versionLabel = input.versionLabel?.trim() || `Round ${Number(runCount?.count ?? 0) + 2} · 基于目标人群重跑`;
  const snapshotPayload = readJsonObject(snapshot.snapshot_json);
  const runMetadata = {
    source: "root_audience_snapshot",
    generator: "local_weighted_rerank_v1",
    ...input.metadata
  };
  const rankedItems = rankItemsForSnapshot(db, input.campaignId, snapshotPayload);

  db.exec("BEGIN IMMEDIATE");
  try {
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
      ORDER BY r.created_at DESC`
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
      ORDER BY r.created_at DESC
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
  const generationRuns = getGenerationRuns(db, campaignId).map((run) => getGenerationRunWithItems(db, run.id));
  const generatedAt = nowIso();

  const payload = {
    generatedAt,
    campaign: board.campaign,
    activeGenerationRun: board.activeGenerationRun,
    rootAudienceSnapshots,
    generationRuns,
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

function rankItemsForSnapshot(db: DatabaseSync, campaignId: string, snapshot: Record<string, unknown>) {
  const decisionValues = readSnapshotDecisionValues(snapshot);
  const approvedRoots = decisionValues.filter((decision) => decision.status === "approved");
  const rejectedRoots = decisionValues.filter((decision) => decision.status === "rejected");
  const questionRoots = decisionValues.filter((decision) => decision.status === "question");

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
        p.content_category,
        p.audience_summary,
        p.metadata AS kol_metadata
      FROM campaign_kol_items i
      JOIN kol_profiles p ON p.id = i.kol_id
      WHERE i.campaign_id = ?`
    )
    .all(campaignId);

  return rows
    .map((row) => {
      const kolMetadata = readJsonObject(row.kol_metadata);
      const riskTags = readJsonArray(row.risk_tags);
      const audienceFit = Number(kolMetadata.audienceFit ?? 0);
      const text = [
        row.why_included,
        row.recommended_angle,
        row.contact_status,
        row.content_category,
        row.audience_summary,
        kolMetadata.rootVisibilitySignal
      ]
        .join(" ")
        .toLowerCase();

      const approvedBoost = approvedRoots.reduce((sum, root) => sum + rootMatchScore(text, root), 0);
      const rejectedPenalty = rejectedRoots.reduce((sum, root) => sum + rootMatchScore(text, root) * 0.7, 0);
      const questionBoost = questionRoots.reduce((sum, root) => sum + rootMatchScore(text, root) * 0.25, 0);
      const contactBoost = contactBoostFor(String(row.contact_status ?? ""));
      const riskPenalty = riskTags.filter((tag) => tag !== "none").length * 2;
      const score = Math.round((audienceFit + approvedBoost + questionBoost + contactBoost - rejectedPenalty - riskPenalty) * 100) / 100;

      return {
        itemId: String(row.item_id),
        score,
        explanation: {
          baseAudienceFit: audienceFit,
          approvedRootCount: approvedRoots.length,
          rejectedRootCount: rejectedRoots.length,
          questionRootCount: questionRoots.length,
          approvedBoost,
          rejectedPenalty,
          questionBoost,
          contactBoost,
          riskPenalty,
          originalDisplayOrder: Number(row.display_order ?? 0)
        }
      };
    })
    .sort((a, b) => b.score - a.score || Number(a.explanation.originalDisplayOrder) - Number(b.explanation.originalDisplayOrder));
}

function readSnapshotDecisionValues(snapshot: Record<string, unknown>) {
  const decisions = snapshot.decisions && typeof snapshot.decisions === "object" && !Array.isArray(snapshot.decisions) ? snapshot.decisions : {};
  return Object.entries(decisions as Record<string, unknown>).map(([handle, value]) => {
    const data = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
      handle,
      status: String(data.status ?? "pending"),
      reason: data.reason ? String(data.reason) : "",
      note: data.note ? String(data.note) : ""
    };
  });
}

function rootMatchScore(text: string, root: { handle: string; status: string; reason: string; note: string }) {
  const handle = root.handle.replace(/^@/, "").toLowerCase();
  const reason = root.reason.toLowerCase();
  const note = root.note.toLowerCase();
  let score = 0;
  if (handle && text.includes(handle)) score += 8;
  if (reason && text.includes(reason)) score += 3;
  if (note && text.includes(note)) score += 2;
  if (/vc|investor|fund|founder|a16z|venture/.test(text) && /vc|投资|investor|founder/i.test(`${reason} ${note}`)) score += 2;
  if (/newsletter|podcast|media|creator/.test(text) && /媒体|newsletter|podcast|creator/i.test(`${reason} ${note}`)) score += 2;
  if (/research|technical|engineer|builder|agent/.test(text) && /技术|agent|builder|research/i.test(`${reason} ${note}`)) score += 2;
  return score;
}

function contactBoostFor(contactStatus: string) {
  if (/明确|confirmed|contact|sponsor|可走/.test(contactStatus)) return 4;
  if (/需|待|unknown|验证/.test(contactStatus)) return 1;
  return 0;
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
