import type { DatabaseSync } from "node:sqlite";
import { getAllProjectConfigs, type ProjectConfig, type RootPersonConfig } from "./projectConfig.js";
import { createTwitter241ClientFromEnv, type Twitter241Client } from "./twitter241.js";
import { ApiError } from "./types.js";

type Row = Record<string, unknown>;

type RootWithGroup = RootPersonConfig & {
  groupName: string;
  groupIndex: number;
  rootIndex: number;
};

type KolTarget = {
  campaignKolItemId: string;
  kolId: string;
  handle: string;
  name: string;
};

type FlattenedUser = {
  restId: string;
  handle: string;
  name: string;
  description: string;
  followers: number;
  following: number;
  avatarUrl: string;
  verified: boolean;
};

export type RootGraphSyncOptions = {
  client?: Twitter241Client | null;
  rootLimit?: number;
  maxPagesPerRoot?: number;
  pageCount?: number;
  retryFailed?: boolean;
  force?: boolean;
};

const syncSource = "twitter241_followings";

export function getRootKolGraphSyncStatus(db: DatabaseSync, campaignId: string) {
  const config = getProjectConfigForCampaign(campaignId);
  const roots = getRoots(config);
  const rootHandles = new Set(roots.map((root) => normalizeHandle(root.handle)));
  const states = db
    .prepare("SELECT * FROM root_kol_graph_sync_state WHERE campaign_id = ? AND sync_source = ?")
    .all(campaignId, syncSource)
    .map(normalizeState)
    .filter((state) => rootHandles.has(normalizeHandle(state.rootHandle)));
  const statesByRoot = new Map(states.map((state) => [normalizeHandle(state.rootHandle), state]));
  const rows = roots.map((root) => {
    const state = statesByRoot.get(normalizeHandle(root.handle));
    return {
      rootHandle: `@${normalizeHandle(root.handle)}`,
      rootName: root.name,
      rootGroup: root.groupName,
      status: state?.status ?? "pending",
      pagesScanned: state?.pagesScanned ?? 0,
      followingsScanned: state?.followingsScanned ?? 0,
      matchedKolCount: state?.matchedKolCount ?? 0,
      lastError: state?.lastError ?? "",
      completedAt: state?.completedAt ?? null,
      updatedAt: state?.updatedAt ?? null
    };
  });
  const twitterStats = getTwitterEdgeStats(db, campaignId);
  const statusCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    campaignId,
    source: syncSource,
    summary: {
      totalRoots: roots.length,
      completedRoots: statusCounts.completed ?? 0,
      inProgressRoots: statusCounts.in_progress ?? 0,
      failedRoots: statusCounts.failed ?? 0,
      pendingRoots: statusCounts.pending ?? 0,
      rootsWithTwitterEdges: twitterStats.rootCount,
      kolsWithTwitterEdges: twitterStats.kolCount,
      twitterEdgeCount: twitterStats.edgeCount,
      missingRootScans: roots.length - (statusCounts.completed ?? 0)
    },
    roots: rows
  };
}

export async function syncRootKolGraphTwitter241(db: DatabaseSync, campaignId: string, options: RootGraphSyncOptions = {}) {
  const client = options.client === undefined ? createTwitter241ClientFromEnv() : options.client;
  if (!client) throw new ApiError(503, "Twitter241 API 尚未配置：请设置 TWITTER241_RAPIDAPI_KEY。");

  const config = getProjectConfigForCampaign(campaignId);
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId) as Row | undefined;
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const roots = getRoots(config);
  const kolTargets = getKolTargets(db, campaignId);
  const pageCount = clamp(options.pageCount ?? Number(process.env.TWITTER241_ROOT_GRAPH_PAGE_COUNT ?? 200), 20, 200);
  const maxPagesPerRoot = clamp(options.maxPagesPerRoot ?? Number(process.env.TWITTER241_ROOT_GRAPH_MAX_PAGES_PER_ROOT ?? 8), 1, 80);
  const rootLimit = clamp(options.rootLimit ?? Number(process.env.TWITTER241_ROOT_GRAPH_ROOT_LIMIT ?? 3), 1, roots.length);
  const timestamp = nowIso();

  ensureSyncStates(db, campaign, campaignId, roots, timestamp);

  const candidates = getNextRootStates(db, campaignId, rootLimit, Boolean(options.retryFailed), Boolean(options.force));
  const processed = [];
  for (const state of candidates) {
    processed.push(await syncOneRoot(db, client, state, kolTargets, { pageCount, maxPagesPerRoot }));
  }

  return {
    campaignId,
    source: syncSource,
    options: {
      rootLimit,
      maxPagesPerRoot,
      pageCount,
      retryFailed: Boolean(options.retryFailed),
      force: Boolean(options.force)
    },
    processed,
    status: getRootKolGraphSyncStatus(db, campaignId)
  };
}

async function syncOneRoot(
  db: DatabaseSync,
  client: Twitter241Client,
  state: ReturnType<typeof normalizeState>,
  kolTargets: Map<string, KolTarget[]>,
  options: { pageCount: number; maxPagesPerRoot: number }
) {
  const startedAt = state.startedAt ?? nowIso();
  let rootRestId = state.rootRestId;
  let cursor = state.cursor || undefined;
  let pagesScanned = state.pagesScanned;
  let followingsScanned = state.followingsScanned;
  let status = "in_progress";
  let errorMessage = "";
  const matchedHandles = new Set<string>();

  try {
    updateState(db, state.id, {
      status: "in_progress",
      startedAt,
      updatedAt: nowIso(),
      lastError: ""
    });

    if (!rootRestId) {
      const rootPayload = await client.get("/user", { username: normalizeHandle(state.rootHandle) });
      const rootProfile = flattenUser(userFromPayload(rootPayload));
      rootRestId = rootProfile.restId;
      if (!rootRestId) throw new Error("Twitter241 did not return a numeric user id.");
      updateState(db, state.id, { rootRestId, updatedAt: nowIso() });
    }

    for (let page = 0; page < options.maxPagesPerRoot; page += 1) {
      const payload = await client.get("/followings", { user: rootRestId, count: options.pageCount, cursor });
      pagesScanned += 1;
      const users = collectUserResults(payload).map(flattenUser).filter((user) => user.handle);
      followingsScanned += users.length;
      for (const user of users) {
        const targets = kolTargets.get(user.handle) ?? [];
        for (const target of targets) {
          matchedHandles.add(target.handle);
          upsertTwitterEdge(db, state, target, user, rootRestId);
        }
      }

      cursor = extractBottomCursor(payload);
      const matchedKolCount = getRootTwitterMatchCount(db, state.campaignId, state.rootHandle);
      const reachedEnd = !cursor || users.length === 0;
      updateState(db, state.id, {
        cursor: reachedEnd ? null : cursor,
        pagesScanned,
        followingsScanned,
        matchedKolCount,
        status: reachedEnd ? "completed" : "in_progress",
        completedAt: reachedEnd ? nowIso() : null,
        updatedAt: nowIso()
      });
      if (reachedEnd) {
        status = "completed";
        cursor = undefined;
        break;
      }
    }

    if (cursor && status !== "completed") {
      status = "in_progress";
      updateState(db, state.id, {
        cursor,
        pagesScanned,
        followingsScanned,
        matchedKolCount: getRootTwitterMatchCount(db, state.campaignId, state.rootHandle),
        status,
        updatedAt: nowIso()
      });
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : "Twitter241 root graph sync failed.";
    updateState(db, state.id, {
      status,
      lastError: errorMessage,
      pagesScanned,
      followingsScanned,
      matchedKolCount: getRootTwitterMatchCount(db, state.campaignId, state.rootHandle),
      updatedAt: nowIso()
    });
  }

  return {
    rootHandle: state.rootHandle,
    rootName: state.rootName,
    status,
    pagesScanned,
    followingsScanned,
    matchedKolCount: getRootTwitterMatchCount(db, state.campaignId, state.rootHandle),
    matchedHandles: Array.from(matchedHandles).sort(),
    error: errorMessage || undefined
  };
}

function ensureSyncStates(db: DatabaseSync, campaign: Row, campaignId: string, roots: RootWithGroup[], timestamp: string) {
  const insert = db.prepare(
    `INSERT INTO root_kol_graph_sync_state (
      id, client_id, campaign_id, root_handle, root_name, root_group, sync_source,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(campaign_id, root_handle, sync_source) DO UPDATE SET
      root_name = excluded.root_name,
      root_group = excluded.root_group,
      updated_at = root_kol_graph_sync_state.updated_at`
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const root of roots) {
      const handle = `@${normalizeHandle(root.handle)}`;
      insert.run(
        `root-graph-${campaignId}-${normalizeHandle(root.handle)}`,
        String(campaign.client_id),
        campaignId,
        handle,
        root.name,
        root.groupName,
        syncSource,
        timestamp,
        timestamp
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getNextRootStates(db: DatabaseSync, campaignId: string, limit: number, retryFailed: boolean, force: boolean) {
  const statuses = force ? ["completed", "failed", "in_progress", "pending"] : retryFailed ? ["failed", "in_progress", "pending"] : ["in_progress", "pending"];
  const placeholders = statuses.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM root_kol_graph_sync_state
      WHERE campaign_id = ?
        AND sync_source = ?
        AND status IN (${placeholders})
      ORDER BY
        CASE status WHEN 'in_progress' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
        root_group ASC,
        root_name ASC
      LIMIT ?`
    )
    .all(campaignId, syncSource, ...statuses, limit)
    .map(normalizeState);
}

function upsertTwitterEdge(db: DatabaseSync, state: ReturnType<typeof normalizeState>, target: KolTarget, user: FlattenedUser, rootRestId: string) {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO root_kol_edges (
      id, client_id, campaign_id, root_handle, root_name, root_group,
      campaign_kol_item_id, kol_id, kol_handle, edge_type, edge_source,
      confidence, evidence, metadata, fetched_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, root_handle, campaign_kol_item_id, edge_source) DO UPDATE SET
      root_name = excluded.root_name,
      root_group = excluded.root_group,
      kol_id = excluded.kol_id,
      kol_handle = excluded.kol_handle,
      edge_type = excluded.edge_type,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      metadata = excluded.metadata,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at`
  ).run(
    `edge-${state.campaignId}-${normalizeHandle(state.rootHandle)}-${target.campaignKolItemId}-${syncSource}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    state.clientId,
    state.campaignId,
    state.rootHandle,
    state.rootName,
    state.rootGroup,
    target.campaignKolItemId,
    target.kolId,
    `@${target.handle}`,
    "twitter_following",
    syncSource,
    0.95,
    `${state.rootHandle} follows @${target.handle} according to Twitter241 /followings.`,
    JSON.stringify({
      provider: "twitter241",
      endpoint: "/followings",
      rootRestId,
      observedUserRestId: user.restId,
      observedName: user.name,
      observedFollowers: user.followers,
      observedFollowing: user.following,
      observedVerified: user.verified,
      observedAvatarUrl: user.avatarUrl
    }),
    timestamp,
    timestamp,
    timestamp
  );
}

function getKolTargets(db: DatabaseSync, campaignId: string) {
  const targets = new Map<string, KolTarget[]>();
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, p.id AS kol_id, p.handle, p.name
      FROM campaign_kol_items i
      JOIN kol_profiles p ON p.id = i.kol_id
      WHERE i.campaign_id = ?`
    )
    .all(campaignId) as Row[];
  for (const row of rows) {
    const handle = normalizeHandle(String(row.handle ?? ""));
    if (!handle) continue;
    const value = {
      campaignKolItemId: String(row.item_id),
      kolId: String(row.kol_id),
      handle,
      name: String(row.name ?? handle)
    };
    const list = targets.get(handle) ?? [];
    list.push(value);
    targets.set(handle, list);
  }
  return targets;
}

function getRootTwitterMatchCount(db: DatabaseSync, campaignId: string, rootHandle: string) {
  return Number(
    db
      .prepare("SELECT COUNT(DISTINCT campaign_kol_item_id) AS count FROM root_kol_edges WHERE campaign_id = ? AND root_handle = ? AND edge_source = ?")
      .get(campaignId, rootHandle, syncSource)?.count ?? 0
  );
}

function getTwitterEdgeStats(db: DatabaseSync, campaignId: string) {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS edge_count,
        COUNT(DISTINCT root_handle) AS root_count,
        COUNT(DISTINCT campaign_kol_item_id) AS kol_count
      FROM root_kol_edges
      WHERE campaign_id = ? AND edge_source = ?`
    )
    .get(campaignId, syncSource) as Row | undefined;
  return {
    edgeCount: Number(row?.edge_count ?? 0),
    rootCount: Number(row?.root_count ?? 0),
    kolCount: Number(row?.kol_count ?? 0)
  };
}

function updateState(db: DatabaseSync, id: string, patch: Record<string, unknown>) {
  const columnMap: Record<string, string> = {
    rootRestId: "root_rest_id",
    status: "status",
    cursor: "cursor",
    pagesScanned: "pages_scanned",
    followingsScanned: "followings_scanned",
    matchedKolCount: "matched_kol_count",
    lastError: "last_error",
    startedAt: "started_at",
    completedAt: "completed_at",
    updatedAt: "updated_at"
  };
  const entries = Object.entries(patch).filter(([key]) => columnMap[key]);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${columnMap[key]} = ?`).join(", ");
  db.prepare(`UPDATE root_kol_graph_sync_state SET ${assignments} WHERE id = ?`).run(...entries.map(([, value]) => toSqlValue(value)), id);
}

function toSqlValue(value: unknown) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value ?? "");
}

function normalizeState(row: Row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    campaignId: String(row.campaign_id),
    rootHandle: String(row.root_handle),
    rootName: String(row.root_name ?? ""),
    rootGroup: String(row.root_group ?? ""),
    rootRestId: String(row.root_rest_id ?? ""),
    status: String(row.status ?? "pending"),
    cursor: row.cursor ? String(row.cursor) : "",
    pagesScanned: Number(row.pages_scanned ?? 0),
    followingsScanned: Number(row.followings_scanned ?? 0),
    matchedKolCount: Number(row.matched_kol_count ?? 0),
    lastError: String(row.last_error ?? ""),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

function getProjectConfigForCampaign(campaignId: string) {
  const config = getAllProjectConfigs().find((candidate) => candidate.campaign.id === campaignId);
  if (!config) throw new ApiError(404, `Project config not found for campaign: ${campaignId}`);
  return config;
}

function getRoots(config: ProjectConfig): RootWithGroup[] {
  const groups = config.ui.roots?.groups ?? [];
  return groups.flatMap((group, groupIndex) => group.people.map((person, rootIndex) => ({ ...person, groupName: group.name, groupIndex, rootIndex })));
}

function userFromPayload(payload: unknown): Record<string, unknown> {
  return readObject(getPath(payload, ["result", "data", "user", "result"])) ?? readObject(getPath(payload, ["result", 0])) ?? {};
}

function collectUserResults(payload: unknown) {
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  function add(user: Record<string, unknown> | null) {
    if (!user || user.__typename === "UserUnavailable" || user.__typename === "UserTombstone") return;
    const flattened = flattenUser(user);
    const key = flattened.restId || flattened.handle;
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(user);
  }

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    const objectValue = value as Record<string, unknown>;
    add(readObject(getPath(objectValue, ["user_results", "result"])));
    add(readObject(getPath(objectValue, ["itemContent", "user_results", "result"])));
    add(readObject(getPath(objectValue, ["content", "itemContent", "user_results", "result"])));
    if (looksLikeUser(objectValue)) add(objectValue);

    Object.values(objectValue).forEach(visit);
  }

  visit(payload);
  return results;
}

function extractBottomCursor(payload: unknown): string | undefined {
  let cursor: string | undefined;
  function visit(value: unknown) {
    if (cursor) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const objectValue = value as Record<string, unknown>;
    const entryId = String(objectValue.entryId ?? objectValue.entry_id ?? "");
    const content = readObject(objectValue.content) ?? objectValue;
    if (entryId.startsWith("cursor-bottom") || content.cursorType === "Bottom") {
      const value = content.value ?? objectValue.value;
      if (typeof value === "string" && value.trim()) cursor = value;
      return;
    }
    Object.values(objectValue).forEach(visit);
  }
  visit(payload);
  return cursor;
}

function flattenUser(user: Record<string, unknown>): FlattenedUser {
  const core = readObject(user.core) ?? {};
  const legacy = readObject(user.legacy) ?? {};
  const verification = readObject(user.verification) ?? {};
  const screenName = String(core.screen_name ?? legacy.screen_name ?? user.screen_name ?? user.username ?? "");
  const description = String(legacy.description ?? user.description ?? user.bio ?? "");
  const avatarUrl = String(legacy.profile_image_url_https ?? legacy.profile_image_url ?? user.profile_image_url_https ?? user.avatar_url ?? "");

  return {
    restId: String(user.rest_id ?? user.id_str ?? user.id ?? ""),
    handle: normalizeHandle(screenName),
    name: String(core.name ?? legacy.name ?? user.name ?? screenName),
    description,
    followers: Number(legacy.followers_count ?? user.followers_count ?? user.followers ?? 0),
    following: Number(legacy.friends_count ?? user.friends_count ?? user.following ?? 0),
    avatarUrl,
    verified: Boolean(verification.verified ?? legacy.verified ?? user.verified ?? false)
  };
}

function looksLikeUser(value: Record<string, unknown>) {
  return Boolean((value.rest_id || value.id || value.id_str) && (value.core || value.legacy || value.username || value.screen_name));
}

function getPath(value: unknown, path: Array<string | number>) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function normalizeHandle(value: string) {
  let handle = value.trim();
  if (!handle) return "";
  handle = handle.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  handle = handle.split(/[/?#]/)[0] ?? "";
  return handle.replace(/^@/, "").trim().toLowerCase();
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function nowIso() {
  return new Date().toISOString();
}
