import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ApiError, selectionStatuses, type ActorRole, type CreateSelectionEventInput, type SelectionStatus, type Summary } from "./types.js";

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

  const itemRows = db
    .prepare(
      `SELECT
        i.id AS item_id,
        i.client_id AS item_client_id,
        i.campaign_id AS item_campaign_id,
        i.display_order,
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
  const generatedAt = nowIso();

  const payload = {
    generatedAt,
    campaign: board.campaign,
    approved: board.items.filter((item) => item.currentState.currentStatus === "approved"),
    rejected: board.items.filter((item) => item.currentState.currentStatus === "rejected"),
    question: board.items.filter((item) => item.currentState.currentStatus === "question"),
    hold: board.items.filter((item) => item.currentState.currentStatus === "hold"),
    pending: board.items.filter((item) => item.currentState.currentStatus === "pending"),
    fullDecisionLog: events
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
  if (actorRole === "client") throw new ApiError(403, "仅团队视图可以锁定版本。");

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
    metadata: readJsonObject(row.item_metadata),
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

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
