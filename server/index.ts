import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db.js";
import { getClientAppConfig, getDefaultProjectId, getProjectConfig } from "./projectConfig.js";
import {
  createSelectionEvent,
  exportSelection,
  getCampaignBoard,
  getSelectionHistory,
  lockSelection
} from "./selectionService.js";
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
