import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { getClientAppConfig, getDefaultProjectId, getProjectConfig } from "./projectConfig.js";
import {
  createClientActionEvent,
  createKolGenerationRun,
  createRootAudienceSnapshot,
  createSelectionEvent,
  getCampaignDecisionHistory,
  exportSelection,
  getCampaignBoard,
  getClientActionEvents,
  getGenerationRuns,
  getGenerationRunWithItems,
  getLatestRootAudienceSnapshot,
  getRootKolEdges,
  getRootKolImpact,
  getRootAudienceSnapshot,
  getSelectionHistory,
  lockSelection,
  resetCampaignReviewState
} from "./selectionService.js";
import { syncCampaignTwitter241 } from "./twitter241SyncService.js";
import { ApiError, actorRoles, type ActorRole, type ApiErrorPayload, type SelectionStatus } from "./types.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, "..");
const port = Number(process.env.PORT ?? 5173);
const defaultProjectConfig = getProjectConfig(getDefaultProjectId());
const defaultProjectId = defaultProjectConfig.projectId;
const campaignFallbackId = defaultProjectConfig.campaign.id;

const db = createDatabase();
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, projectId: defaultProjectId, campaignId: campaignFallbackId });
});

app.get("/api/app-config", (req, res, next) => {
  try {
    const projectId = typeof req.query.project === "string" ? req.query.project : undefined;
    res.json(getClientAppConfig(projectId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/project-configs", (_req, res, next) => {
  try {
    res.json({ projects: getClientAppConfig().availableProjects });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-selection", (req, res, next) => {
  try {
    const actorRole = parseActorRole(req.query.role ?? req.header("x-actor-role") ?? "client");
    res.json(getCampaignBoard(db, req.params.campaignId, actorRole));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/campaigns/:campaignId/reset-review-state", (req, res, next) => {
  try {
    const expectedToken = process.env.ADMIN_RESET_TOKEN?.trim();
    const token = String(req.header("x-admin-reset-token") ?? req.body?.token ?? "");
    if (!expectedToken || token !== expectedToken) throw new ApiError(403, "无权执行重置操作。");
    res.json({ reset: resetCampaignReviewState(db, req.params.campaignId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-selection/decision-history", (req, res, next) => {
  try {
    const actorRole = parseActorRole(req.query.role ?? req.header("x-actor-role") ?? "client");
    res.json(getCampaignDecisionHistory(db, req.params.campaignId, actorRole));
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/client-actions", (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({
      events: getClientActionEvents(db, req.params.campaignId, {
        surface: typeof req.query.surface === "string" ? req.query.surface : undefined,
        entityType: typeof req.query.entity_type === "string" ? req.query.entity_type : typeof req.query.entityType === "string" ? req.query.entityType : undefined,
        entityId: typeof req.query.entity_id === "string" ? req.query.entity_id : typeof req.query.entityId === "string" ? req.query.entityId : undefined,
        limit
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/root-kol-edges", (req, res, next) => {
  try {
    const includeEdges = req.query.include_edges === "1" || req.query.includeEdges === "1";
    res.json({
      impact: getRootKolImpact(db, req.params.campaignId),
      edges: includeEdges ? getRootKolEdges(db, req.params.campaignId) : undefined
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/client-actions", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const actorRole = parseActorRole(req.header("x-actor-role") ?? body.actor_role ?? body.actorRole ?? "client");
    const actorId = String(req.header("x-actor-id") ?? body.actor_id ?? body.actorId ?? "client-reviewer-1");
    const event = createClientActionEvent(db, {
      campaignId: req.params.campaignId,
      actorId,
      actorRole,
      surface: String(body.surface ?? ""),
      entityType: String(body.entity_type ?? body.entityType ?? ""),
      entityId: String(body.entity_id ?? body.entityId ?? ""),
      actionType: String(body.action_type ?? body.actionType ?? ""),
      fromValue: body.from_value ?? body.fromValue ?? null,
      toValue: body.to_value ?? body.toValue ?? null,
      reasonTags: body.reason_tags ?? body.reasonTags ?? [],
      note: body.note ?? "",
      metadata: body.metadata ?? {},
      clientRequestId: body.client_request_id ?? body.clientRequestId
    });
    res.status(201).json({ event });
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/root-audience/snapshots", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const actorRole = parseActorRole(req.header("x-actor-role") ?? body.actor_role ?? body.actorRole ?? "client");
    const actorId = String(req.header("x-actor-id") ?? body.actor_id ?? body.actorId ?? "client-reviewer-1");
    const snapshot = createRootAudienceSnapshot(db, {
      campaignId: req.params.campaignId,
      actorId,
      actorRole,
      round: Number(body.round ?? body.snapshot?.round ?? 1),
      snapshot: body.snapshot ?? {},
      clientRequestId: body.client_request_id ?? body.clientRequestId
    });
    res.status(201).json({ snapshot });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/root-audience/snapshots/latest", (req, res, next) => {
  try {
    res.json({ snapshot: getLatestRootAudienceSnapshot(db, req.params.campaignId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/kol-generation-runs", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const actorRole = parseActorRole(req.header("x-actor-role") ?? body.actor_role ?? body.actorRole ?? "client");
    const actorId = String(req.header("x-actor-id") ?? body.actor_id ?? body.actorId ?? "client-reviewer-1");
    const sourceSnapshotId = String(body.source_snapshot_id ?? body.sourceSnapshotId ?? "");
    const sourceSnapshot = getRootAudienceSnapshot(db, req.params.campaignId, sourceSnapshotId);
    if (!sourceSnapshot) throw new ApiError(404, "未找到目标人群确认快照。");

    const run = createKolGenerationRun(db, {
      campaignId: req.params.campaignId,
      actorId,
      actorRole,
      sourceSnapshotId,
      versionLabel: body.version_label ?? body.versionLabel,
      triggerReason: body.trigger_reason ?? body.triggerReason,
      metadata: {
        ...(body.metadata ?? {}),
        providerStatus: "seed_pool"
      },
      discoveredCandidates: [],
      discoveryMetadata: {
        provider: "seed_pool",
        strategy: "seed_pool_root_filter_v1",
        status: "succeeded"
      },
      clientRequestId: body.client_request_id ?? body.clientRequestId
    });
    res.status(201).json({ run });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-generation-runs", (req, res, next) => {
  try {
    res.json({ runs: getGenerationRuns(db, req.params.campaignId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-generation-runs/:runId/items", (req, res, next) => {
  try {
    const run = getGenerationRunWithItems(db, req.params.runId);
    if (run.campaignId !== req.params.campaignId) throw new ApiError(404, "未找到 KOL 生成版本。");
    res.json({ run });
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/kol-selection/:itemId/events", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const actorRole = parseActorRole(req.header("x-actor-role") ?? body.actor_role ?? body.actorRole ?? "client");
    const actorId = String(req.header("x-actor-id") ?? body.actor_id ?? body.actorId ?? "client-reviewer-1");
    const toStatus = String(body.to_status ?? body.toStatus ?? body.decision ?? "pending") as SelectionStatus;

    const result = createSelectionEvent(db, {
      campaignId: req.params.campaignId,
      itemId: req.params.itemId,
      actorId,
      actorRole,
      toStatus,
      decision: body.decision ?? toStatus,
      reasonTags: body.reason_tags ?? body.reasonTags ?? [],
      note: body.note ?? "",
      visibility: body.visibility ?? "client_visible",
      clientRequestId: body.client_request_id ?? body.clientRequestId,
      metadata: body.metadata ?? {}
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-selection/:itemId/events", (req, res, next) => {
  try {
    res.json({ events: getSelectionHistory(db, req.params.campaignId, req.params.itemId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/campaigns/:campaignId/kol-selection/export", (req, res, next) => {
  try {
    const format = req.query.format === "csv" ? "csv" : "json";
    const exported = exportSelection(db, req.params.campaignId, format);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.campaignId}-kol-selection.csv"`);
      res.send(exported);
      return;
    }
    res.json(exported);
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/kol-selection/lock", (req, res, next) => {
  try {
    const actorRole = parseActorRole(req.header("x-actor-role") ?? req.body?.actorRole ?? "agency");
    const actorId = String(req.header("x-actor-id") ?? req.body?.actorId ?? "agency-ops");
    res.json(lockSelection(db, req.params.campaignId, actorId, actorRole));
  } catch (error) {
    next(error);
  }
});

app.post("/api/campaigns/:campaignId/kol-selection/sync-twitter241", async (req, res, next) => {
  try {
    const actorRole = parseActorRole(req.header("x-actor-role") ?? req.body?.actorRole ?? "agency");
    if (actorRole === "client") throw new ApiError(403, "当前客户评审版不能同步 Twitter241 执行池数据。");

    const handles = Array.isArray(req.body?.handles) ? req.body.handles.map(String) : undefined;
    const tweetCount = Number(req.body?.tweet_count ?? req.body?.tweetCount ?? req.query.count ?? undefined);

    res.json(
      await syncCampaignTwitter241(db, req.params.campaignId, {
        handles,
        tweetCount
      })
    );
  } catch (error) {
    next(error);
  }
});

app.use((error: Error, _req: Request, res: Response<ApiErrorPayload>, _next: NextFunction) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Unexpected server error" });
});

await attachFrontend(app);

app.listen(port, () => {
  console.log(`Client KOL Selection Console running at http://localhost:${port}`);
});

function parseActorRole(value: unknown): ActorRole {
  const role = String(value);
  if (actorRoles.includes(role as ActorRole)) return role as ActorRole;
  return "client";
}

async function attachFrontend(expressApp: express.Express) {
  if (process.env.NODE_ENV === "production") {
    const distDir = path.join(appRoot, "dist");
    expressApp.use(express.static(distDir));
    expressApp.use((_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    return;
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    root: appRoot,
    server: { middlewareMode: true },
    appType: "spa"
  });
  expressApp.use(vite.middlewares);
}
