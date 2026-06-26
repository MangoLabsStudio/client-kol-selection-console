import type { DatabaseSync } from "node:sqlite";
import type { ProjectConfig, RootPersonConfig, SeedKolConfig } from "./projectConfig.js";

type RootWithGroup = RootPersonConfig & {
  groupName: string;
};

export type RootKolEdgeSeed = {
  rootHandle: string;
  rootName: string;
  rootGroup: string;
  kol: SeedKolConfig;
  edgeType: "explicit_signal" | "signal_archetype" | "lane_inference";
  edgeSource: string;
  confidence: number;
  evidence: string;
  metadata?: Record<string, unknown>;
};

const laneRootRules: Record<string, Array<{ handles: string[]; confidence: number; evidence: string }>> = {
  agent_builder: [
    {
      handles: ["@karpathy", "@amasad", "@hwchase17", "@simonw", "@swyx", "@mckaywrigley", "@yoheinakajima"],
      confidence: 0.38,
      evidence: "lane=agent_builder maps to AI builder / engineering root audience."
    }
  ],
  ai_media_newsletter: [
    {
      handles: ["@sama", "@AndrewYNg", "@saranormous", "@venturetwins", "@emollick", "@swyx"],
      confidence: 0.34,
      evidence: "lane=ai_media_newsletter maps to AI media routes likely to enter founder, VC, and expert information flows."
    }
  ],
  consumer_social_ai: [
    {
      handles: ["@mustafasuleyman", "@venturetwins", "@omooretweets", "@ekuyda", "@jasonyuan"],
      confidence: 0.38,
      evidence: "lane=consumer_social_ai maps to consumer AI / social AI root audience."
    }
  ],
  ai_tools_education: [
    {
      handles: ["@AndrewYNg", "@simonw", "@jeremyphoward", "@rasbt"],
      confidence: 0.37,
      evidence: "lane=ai_tools_education maps to AI adoption, tooling, and education roots."
    }
  ],
  creative_ai: [
    {
      handles: ["@venturetwins", "@omooretweets", "@jasonyuan", "@emollick"],
      confidence: 0.34,
      evidence: "lane=creative_ai maps to consumer / creator AI roots."
    }
  ],
  deep_ai_discussion: [
    {
      handles: ["@karpathy", "@ylecun", "@fchollet", "@hardmaru", "@lilianweng", "@shunyuYao12"],
      confidence: 0.42,
      evidence: "lane=deep_ai_discussion maps to research and technical debate roots."
    }
  ],
  broad_ai: [
    {
      handles: ["@sama", "@AndrewYNg", "@emollick", "@swyx"],
      confidence: 0.26,
      evidence: "lane=broad_ai maps broadly to AI adoption and builder information flows."
    }
  ],
  general_tech: [
    {
      handles: ["@pmarca", "@andrewchen", "@mignano"],
      confidence: 0.24,
      evidence: "lane=general_tech maps weakly to tech founder and investor roots."
    }
  ]
};

const signalRootRules: Array<{ pattern: RegExp; handles: string[]; confidence: number; evidence: string }> = [
  {
    pattern: /economy_as_fitness/i,
    handles: ["@elonmusk", "@pmarca", "@saranormous", "@emollick"],
    confidence: 0.48,
    evidence: "rootVisibilitySignal=economy_as_fitness maps to public AI/product thesis roots."
  },
  {
    pattern: /smallville_with_stakes/i,
    handles: ["@venturetwins", "@omooretweets", "@ekuyda", "@jasonyuan"],
    confidence: 0.48,
    evidence: "rootVisibilitySignal=smallville_with_stakes maps to social / character AI roots."
  },
  {
    pattern: /reality_permeability/i,
    handles: ["@mustafasuleyman", "@hardmaru", "@emollick", "@jasonyuan"],
    confidence: 0.46,
    evidence: "rootVisibilitySignal=reality_permeability maps to AI adoption and AI-native social roots."
  },
  {
    pattern: /survival_compute/i,
    handles: ["@karpathy", "@JeffDean", "@fchollet", "@hardmaru", "@lilianweng"],
    confidence: 0.46,
    evidence: "rootVisibilitySignal=survival_compute maps to technical AI / research roots."
  }
];

export function seedRootKolEdges(db: DatabaseSync, config: ProjectConfig, timestamp: string) {
  const edges = buildRootKolEdges(config);
  const seen = new Set<string>();
  removeEdgesForUnconfiguredRoots(db, config);
  const insert = db.prepare(
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
  );

  for (const edge of edges) {
    const itemId = getItemId(config, edge.kol);
    const key = [config.campaign.id, normalizeHandle(edge.rootHandle), itemId, edge.edgeSource].join("::");
    if (seen.has(key)) continue;
    seen.add(key);

    insert.run(
      `edge-${config.projectId}-${normalizeHandle(edge.rootHandle)}-${edge.kol.id}-${edge.edgeSource}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
      config.client.id,
      config.campaign.id,
      `@${normalizeHandle(edge.rootHandle)}`,
      edge.rootName,
      edge.rootGroup,
      itemId,
      edge.kol.id,
      `@${normalizeHandle(edge.kol.handle)}`,
      edge.edgeType,
      edge.edgeSource,
      edge.confidence,
      edge.evidence,
      JSON.stringify(edge.metadata ?? {}),
      null,
      timestamp,
      timestamp
    );
  }

  return { insertedOrUpdated: seen.size };
}

function removeEdgesForUnconfiguredRoots(db: DatabaseSync, config: ProjectConfig) {
  const rootHandles = getRoots(config).map((root) => `@${normalizeHandle(root.handle)}`);
  if (rootHandles.length === 0) {
    db.prepare("DELETE FROM root_kol_edges WHERE campaign_id = ?").run(config.campaign.id);
    return;
  }

  const placeholders = rootHandles.map(() => "?").join(", ");
  db.prepare(`DELETE FROM root_kol_edges WHERE campaign_id = ? AND root_handle NOT IN (${placeholders})`).run(config.campaign.id, ...rootHandles);
}

export function buildRootKolEdges(config: ProjectConfig): RootKolEdgeSeed[] {
  const roots = getRoots(config);
  const rootsByHandle = new Map(roots.map((root) => [normalizeHandle(root.handle), root]));
  const edges: RootKolEdgeSeed[] = [];

  for (const kol of config.seed.candidates) {
    const signal = String(kol.metadata?.rootVisibilitySignal ?? "");
    addExplicitSignalEdges(edges, roots, kol, signal);
    addSignalArchetypeEdges(edges, rootsByHandle, kol, signal);
    addLaneInferenceEdges(edges, rootsByHandle, kol);
  }

  return edges;
}

function addExplicitSignalEdges(edges: RootKolEdgeSeed[], roots: RootWithGroup[], kol: SeedKolConfig, signal: string) {
  if (!signal.trim()) return;
  const matched = roots.filter((root) => rootMentionedInSignal(root, signal));
  for (const root of matched) {
    edges.push({
      rootHandle: root.handle,
      rootName: root.name,
      rootGroup: root.groupName,
      kol,
      edgeType: "explicit_signal",
      edgeSource: "root_visibility_signal",
      confidence: 0.78,
      evidence: signal,
      metadata: { rootVisibilitySignal: signal }
    });
  }
}

function addSignalArchetypeEdges(
  edges: RootKolEdgeSeed[],
  rootsByHandle: Map<string, RootWithGroup>,
  kol: SeedKolConfig,
  signal: string
) {
  if (!signal.trim()) return;
  for (const rule of signalRootRules) {
    if (!rule.pattern.test(signal)) continue;
    for (const handle of rule.handles) {
      const root = rootsByHandle.get(normalizeHandle(handle));
      if (!root) continue;
      edges.push({
        rootHandle: root.handle,
        rootName: root.name,
        rootGroup: root.groupName,
        kol,
        edgeType: "signal_archetype",
        edgeSource: "root_visibility_archetype",
        confidence: rule.confidence,
        evidence: `${rule.evidence} Signal: ${signal}`,
        metadata: { rootVisibilitySignal: signal }
      });
    }
  }
}

function addLaneInferenceEdges(edges: RootKolEdgeSeed[], rootsByHandle: Map<string, RootWithGroup>, kol: SeedKolConfig) {
  const lane = String(kol.metadata?.lane ?? kol.contentCategory ?? "");
  const rules = laneRootRules[lane];
  if (!rules) return;

  for (const rule of rules) {
    for (const handle of rule.handles) {
      const root = rootsByHandle.get(normalizeHandle(handle));
      if (!root) continue;
      edges.push({
        rootHandle: root.handle,
        rootName: root.name,
        rootGroup: root.groupName,
        kol,
        edgeType: "lane_inference",
        edgeSource: "seed_pool_lane_rule",
        confidence: rule.confidence,
        evidence: rule.evidence,
        metadata: { lane }
      });
    }
  }
}

function rootMentionedInSignal(root: RootWithGroup, signal: string) {
  const handle = normalizeHandle(root.handle);
  const firstName = root.name.split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "") ?? "";
  const terms = [handle, root.name, firstName].filter((term) => term.length >= 4);
  return terms.some((term) => new RegExp(`(^|[^a-z0-9_])${escapeRegExp(term)}([^a-z0-9_]|$)`, "i").test(signal));
}

function getRoots(config: ProjectConfig): RootWithGroup[] {
  const groups = config.ui.roots?.groups ?? [];
  return groups.flatMap((group) => group.people.map((person) => ({ ...person, groupName: group.name })));
}

function getItemId(config: ProjectConfig, kol: SeedKolConfig) {
  return kol.itemId ?? `item-${config.projectId}-${kol.id}`;
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
