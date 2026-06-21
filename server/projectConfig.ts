import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "./types.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, "..");
const configDir = path.join(appRoot, "server", "project-configs");
const fallbackProjectId = "ilands-aaa-signal-map";
const configCache = new Map<string, ProjectConfig>();

export type ProjectConfigSummary = {
  projectId: string;
  clientName: string;
  campaignName: string;
};

export type ProjectConfig = {
  projectId: string;
  client: {
    id: string;
    name: string;
    tier: string;
  };
  campaign: {
    id: string;
    name: string;
    reviewRound: string;
    objective: string;
  };
  ui: ProjectUiConfig;
  seed: {
    now?: string;
    candidates: SeedKolConfig[];
  };
};

export type ProjectUiConfig = {
  brand: {
    mark: string;
    name: string;
    subtitle: string;
  };
  navigation: Array<{
    label: string;
    target: string;
    index: string;
  }>;
  sideNote: string;
  hero: {
    eyebrow: string;
    title: string;
    lede: string;
    metricLabels: {
      total: string;
      approved: string;
      rejected: string;
      question: string;
    };
  };
  pool: {
    eyebrow: string;
    title: string;
    description: string;
    allCandidatesLabel: string;
    pendingDecisionLabel: string;
    reviewedLabel: string;
    emptyTitle: string;
    emptyAction: string;
  };
  learning: {
    storageKey: string;
    eyebrow: string;
    title: string;
    description: string;
    systemTitle: string;
    systemDescription: string;
    exportProject: string;
    exportRound: string;
    sections: LearningRuleSectionConfig[];
  };
  rules: {
    title: string;
    description: string;
    statLabel: string;
    sections: RuleSectionConfig[];
  };
};

export type LearningRuleSectionConfig = {
  id: string;
  title: string;
  subtitle: string;
  open?: boolean;
  defaultRules: string[];
};

export type RuleSectionConfig = {
  title: string;
  subtitle: string;
  open?: boolean;
  rules: string[];
};

export type SeedKolConfig = {
  id: string;
  itemId?: string;
  name: string;
  handle: string;
  platform: string;
  profileUrl: string;
  avatarUrl: string;
  followers: number;
  region: string;
  language: string;
  contentCategory: string;
  bio: string;
  audienceSummary: string;
  whyIncluded: string;
  recommendedAngle: string;
  clientFacingNote: string;
  agencyInternalNote: string;
  estimatedPrice: string;
  contactStatus: string;
  riskTags: string[];
  metadata: Record<string, unknown>;
  initial?: {
    status: "approved" | "rejected" | "question" | "hold";
    reasonTags: string[];
    note: string;
    actorRole?: "client" | "agency";
  };
};

export type ClientAppConfig = {
  projectId: string;
  clientName: string;
  campaignId: string;
  campaignName: string;
  ui: ProjectUiConfig;
  availableProjects: ProjectConfigSummary[];
};

export function getDefaultProjectId() {
  return normalizeProjectId(process.env.KOL_PROJECT_CONFIG ?? process.env.DEMO_PROJECT_CONFIG ?? fallbackProjectId);
}

export function getProjectConfig(projectId = getDefaultProjectId()): ProjectConfig {
  const configPath = resolveConfigPath(projectId);
  if (!existsSync(configPath)) {
    throw new ApiError(404, `Project config not found: ${projectId}`);
  }

  const cached = configCache.get(configPath);
  if (cached) return cached;

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as ProjectConfig;
  assertProjectConfig(parsed, configPath);
  configCache.set(configPath, parsed);
  return parsed;
}

export function getAllProjectConfigs() {
  if (!existsSync(configDir)) return [getProjectConfig()];

  const configs = readdirSync(configDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => getProjectConfig(file.replace(/\.json$/, "")));

  return configs.length > 0 ? configs : [getProjectConfig()];
}

export function getClientAppConfig(projectId?: string): ClientAppConfig {
  const config = getProjectConfig(projectId);
  return {
    projectId: config.projectId,
    clientName: config.client.name,
    campaignId: config.campaign.id,
    campaignName: config.campaign.name,
    ui: config.ui,
    availableProjects: getAllProjectConfigs().map((candidate) => ({
      projectId: candidate.projectId,
      clientName: candidate.client.name,
      campaignName: candidate.campaign.name
    }))
  };
}

function normalizeProjectId(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("/")) return trimmed;
  return trimmed.replace(/\.json$/, "") || fallbackProjectId;
}

function resolveConfigPath(projectIdOrPath: string) {
  const normalized = normalizeProjectId(projectIdOrPath);
  if (normalized.includes("/")) {
    return path.isAbsolute(normalized) ? normalized : path.resolve(appRoot, normalized);
  }
  return path.join(configDir, `${normalized}.json`);
}

function assertProjectConfig(config: ProjectConfig, source: string) {
  const missing: string[] = [];
  if (!config.projectId) missing.push("projectId");
  if (!config.client?.id) missing.push("client.id");
  if (!config.client?.name) missing.push("client.name");
  if (!config.campaign?.id) missing.push("campaign.id");
  if (!config.campaign?.name) missing.push("campaign.name");
  if (!config.ui?.brand?.name) missing.push("ui.brand.name");
  if (!Array.isArray(config.ui?.learning?.sections)) missing.push("ui.learning.sections");
  if (!Array.isArray(config.ui?.rules?.sections)) missing.push("ui.rules.sections");
  if (!Array.isArray(config.seed?.candidates)) missing.push("seed.candidates");

  if (missing.length > 0) {
    throw new ApiError(500, `Invalid project config ${source}`, { missing });
  }
}
