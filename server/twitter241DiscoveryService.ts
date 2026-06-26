import { createTwitter241ClientFromEnv, type Twitter241Client } from "./twitter241.js";
import type { DiscoveredKolCandidateInput, RootAudienceSnapshotPayload } from "./types.js";

type RootSeed = {
  handle: string;
  name: string;
  role: string;
  groupName: string;
  status: string;
};

type FlattenedUser = {
  restId: string;
  handle: string;
  name: string;
  description: string;
  followers: number;
  following: number;
  statuses: number;
  avatarUrl: string;
  verified: boolean;
};

export type Twitter241DiscoveryResult = {
  provider: "twitter241";
  status: "succeeded" | "partial" | "unavailable" | "failed";
  candidates: DiscoveredKolCandidateInput[];
  metadata: {
    provider: "twitter241";
    status: "succeeded" | "partial" | "unavailable" | "failed";
    rootSeeds: Array<Pick<RootSeed, "handle" | "name" | "groupName" | "status">>;
    searchQueries: string[];
    fetchedUserCount: number;
    candidateCount: number;
    errors: string[];
  };
};

export type Twitter241DiscoveryOptions = {
  client?: Twitter241Client | null;
  rootLimit?: number;
  followingCount?: number;
  searchCount?: number;
  maxCandidates?: number;
};

export async function discoverRootAudienceKolCandidates(
  snapshot: RootAudienceSnapshotPayload | Record<string, unknown>,
  options: Twitter241DiscoveryOptions = {}
): Promise<Twitter241DiscoveryResult> {
  const client = options.client === undefined ? createTwitter241ClientFromEnv() : options.client;
  const rootSeeds = readRootSeeds(snapshot).slice(0, clampCount(options.rootLimit ?? Number(process.env.TWITTER241_DISCOVERY_ROOT_LIMIT ?? 5), 1, 12));
  const rootHandleExclusions = readRootHandleExclusions(snapshot);
  const searchQueries = buildSearchQueries(snapshot, rootSeeds).slice(0, 5);
  const metadata = {
    provider: "twitter241" as const,
    status: "unavailable" as Twitter241DiscoveryResult["status"],
    rootSeeds: rootSeeds.map(({ handle, name, groupName, status }) => ({ handle, name, groupName, status })),
    searchQueries,
    fetchedUserCount: 0,
    candidateCount: 0,
    errors: [] as string[]
  };

  if (!client) {
    metadata.errors.push("TWITTER241_RAPIDAPI_KEY is not configured.");
    return { provider: "twitter241", status: "unavailable", candidates: [], metadata };
  }

  const followingCount = clampCount(options.followingCount ?? Number(process.env.TWITTER241_DISCOVERY_FOLLOWING_COUNT ?? 40), 5, 100);
  const searchCount = clampCount(options.searchCount ?? Number(process.env.TWITTER241_DISCOVERY_SEARCH_COUNT ?? 25), 5, 80);
  const maxCandidates = clampCount(options.maxCandidates ?? Number(process.env.TWITTER241_DISCOVERY_MAX_CANDIDATES ?? 140), 20, 300);
  const candidates = new Map<string, DiscoveredKolCandidateInput>();

  for (const seed of rootSeeds) {
    try {
      const rootPayload = await client.get("/user", { username: seed.handle });
      const rootProfile = flattenUser(userFromPayload(rootPayload));
      if (!rootProfile.restId) {
        metadata.errors.push(`Could not resolve root ${seed.handle}.`);
        continue;
      }

      const followingsPayload = await client.get("/followings", { user: rootProfile.restId, count: followingCount });
      const users = collectUserResults(followingsPayload).map(flattenUser).filter((user) => isUsableCandidate(user, rootHandleExclusions));
      metadata.fetchedUserCount += users.length;
      for (const user of users) addCandidate(candidates, user, seed, "root_followings");
    } catch (error) {
      metadata.errors.push(`Root ${seed.handle}: ${error instanceof Error ? error.message : "Twitter241 request failed."}`);
    }
  }

  for (const query of searchQueries) {
    try {
      const searchPayload = await fetchSearch(client, query, searchCount);
      const users = collectUserResults(searchPayload).map(flattenUser).filter((user) => isUsableCandidate(user, rootHandleExclusions));
      metadata.fetchedUserCount += users.length;
      for (const user of users) addCandidate(candidates, user, undefined, "people_search", query);
    } catch (error) {
      metadata.errors.push(`Search "${query}": ${error instanceof Error ? error.message : "Twitter241 search failed."}`);
    }
  }

  const sorted = Array.from(candidates.values())
    .sort((a, b) => Number(b.scoreHint ?? 0) - Number(a.scoreHint ?? 0))
    .slice(0, maxCandidates);
  metadata.candidateCount = sorted.length;
  metadata.status = sorted.length > 0 ? (metadata.errors.length > 0 ? "partial" : "succeeded") : metadata.errors.length > 0 ? "failed" : "unavailable";

  return {
    provider: "twitter241",
    status: metadata.status,
    candidates: sorted,
    metadata
  };
}

async function fetchSearch(client: Twitter241Client, query: string, count: number) {
  try {
    return await client.get("/search", { query, type: "People", count });
  } catch (error) {
    return client.get("/search-v2", { query, type: "People", count });
  }
}

function addCandidate(
  candidates: Map<string, DiscoveredKolCandidateInput>,
  user: FlattenedUser,
  seed: RootSeed | undefined,
  source: "root_followings" | "people_search",
  query?: string
) {
  const existing = candidates.get(user.handle);
  const scoreHint = scoreUser(user, seed, source, query);
  const candidate: DiscoveredKolCandidateInput = {
    handle: user.handle,
    name: user.name || user.handle,
    platform: "X",
    profileUrl: `https://x.com/${user.handle}`,
    avatarUrl: user.avatarUrl,
    bio: user.description,
    followers: user.followers,
    region: "Global",
    language: "EN",
    contentCategory: inferContentCategory(`${user.name} ${user.description}`),
    audienceSummary: `${seed ? `来自 @${seed.handle} followings` : `来自搜索「${query}」`}；${formatCompactNumber(user.followers)} followers。`,
    whyIncluded: seed
      ? `客户确认的 root audience @${seed.handle} 关注网络中召回，适合进入下一轮质量和商务验证。`
      : `根据目标人群语义搜索「${query}」召回，适合进入下一轮质量和商务验证。`,
    recommendedAngle: inferRecommendedAngle(`${user.name} ${user.description}`),
    contactStatus: inferContactStatus(user.description),
    riskTags: [],
    scoreHint,
    source: `twitter241_${source}`,
    sourceRootHandle: seed ? `@${seed.handle}` : undefined,
    metadata: {
      restId: user.restId,
      verified: user.verified,
      following: user.following,
      statuses: user.statuses,
      discoverySource: source,
      searchQuery: query ?? null
    }
  };

  if (!existing || Number(existing.scoreHint ?? 0) < scoreHint) {
    candidates.set(user.handle, candidate);
  }
}

function scoreUser(user: FlattenedUser, seed: RootSeed | undefined, source: string, query?: string) {
  const text = `${user.name} ${user.description} ${query ?? ""}`.toLowerCase();
  let score = 48;
  score += Math.min(28, Math.log10(Math.max(user.followers, 1)) * 5);
  if (source === "root_followings") score += 16;
  if (seed?.status === "approved") score += 8;
  if (seed?.groupName && rootGroupMatch(text, seed.groupName)) score += 10;
  if (/ai|agent|agi|llm|ml|machine learning|openai|anthropic|deepmind|research|builder|developer|founder|product/.test(text)) score += 12;
  if (/newsletter|podcast|youtube|creator|writer|media|sponsor|partnership/.test(text)) score += 8;
  if (/vc|venture|investor|startup|founder|fund/.test(text)) score += 7;
  if (user.verified) score += 4;
  if (user.followers < 2_000) score -= 10;
  return Math.round(Math.max(35, Math.min(score, 120)) * 100) / 100;
}

function readRootSeeds(snapshot: RootAudienceSnapshotPayload | Record<string, unknown>) {
  const seeds: RootSeed[] = [];
  const seen = new Set<string>();
  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  for (const group of groups) {
    const groupRecord = readObject(group) ?? {};
    const groupName = String(groupRecord.name ?? "");
    const people = Array.isArray(groupRecord.people) ? groupRecord.people : [];
    for (const person of people) {
      const personRecord = readObject(person) ?? {};
      const status = String(personRecord.status ?? "pending");
      if (status !== "approved" && status !== "question") continue;
      const handle = normalizeHandle(String(personRecord.handle ?? ""));
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      seeds.push({
        handle,
        name: String(personRecord.name ?? handle),
        role: String(personRecord.role ?? ""),
        groupName,
        status
      });
    }
  }

  const statusRank = { approved: 0, question: 1, pending: 2, rejected: 3 } as Record<string, number>;
  return seeds.sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9));
}

function readRootHandleExclusions(snapshot: RootAudienceSnapshotPayload | Record<string, unknown>) {
  const handles = new Set<string>();
  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  for (const group of groups) {
    const groupRecord = readObject(group) ?? {};
    const people = Array.isArray(groupRecord.people) ? groupRecord.people : [];
    for (const person of people) {
      const personRecord = readObject(person) ?? {};
      const handle = normalizeHandle(String(personRecord.handle ?? ""));
      if (handle) handles.add(handle);
    }
  }
  return handles;
}

function buildSearchQueries(snapshot: RootAudienceSnapshotPayload | Record<string, unknown>, seeds: RootSeed[]) {
  const queries = new Set<string>();
  for (const seed of seeds) {
    if (/vc|投资|venture|investor/i.test(seed.groupName)) {
      queries.add("AI investor founder creator");
      queries.add("AI venture partner agent startup");
    } else if (/垂类|专家|核心|builder|expert/i.test(seed.groupName)) {
      queries.add("AI agent builder creator");
      queries.add("AI engineering newsletter");
    } else {
      queries.add("AI agent founder product");
      queries.add("frontier AI founder creator");
    }
  }

  const comments = readObject(snapshot.ruleComments) ?? {};
  for (const comment of Object.values(comments).map(String)) {
    const compact = comment.replace(/[^\p{L}\p{N}\s/.-]/gu, " ").replace(/\s+/g, " ").trim();
    if (compact) queries.add(compact.split(/\s+/).slice(0, 8).join(" "));
  }

  if (queries.size === 0) {
    queries.add("AI agent builder creator");
    queries.add("AI founder newsletter");
  }
  return Array.from(queries);
}

function isUsableCandidate(user: FlattenedUser, seedHandles: Set<string>) {
  if (!user.handle || seedHandles.has(user.handle)) return false;
  if (user.handle.length > 32 || /[^a-z0-9_]/i.test(user.handle)) return false;
  const text = `${user.name} ${user.description}`.toLowerCase();
  if (user.followers >= 20_000) return true;
  return user.followers >= 1_500 && /ai|agent|agi|llm|ml|machine learning|research|builder|developer|founder|startup|newsletter|podcast|creator|vc|venture/.test(text);
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

function userFromPayload(payload: unknown): Record<string, unknown> {
  return readObject(getPath(payload, ["result", "data", "user", "result"])) ?? {};
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
    statuses: Number(legacy.statuses_count ?? user.statuses_count ?? 0),
    avatarUrl,
    verified: Boolean(verification.verified ?? legacy.verified ?? user.verified ?? false)
  };
}

function looksLikeUser(value: Record<string, unknown>) {
  return Boolean((value.rest_id || value.id || value.id_str) && (value.core || value.legacy || value.username || value.screen_name));
}

function rootGroupMatch(text: string, groupName: string) {
  if (/vc|投资|venture|investor/i.test(groupName)) return /vc|venture|investor|fund|startup|founder|newsletter|podcast|media/.test(text);
  if (/垂类|专家|核心|builder|expert/i.test(groupName)) return /agent|builder|engineer|developer|research|tool|product|tutorial/.test(text);
  return /ai|agent|founder|frontier|product|research|builder|creator/.test(text);
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

function inferRecommendedAngle(text: string) {
  const normalized = text.toLowerCase();
  if (/vc|venture|investor|fund|startup/.test(normalized)) return "先验证投资/BD 路径，再判断是否适合 warm intro。";
  if (/newsletter|podcast|media|creator|youtube|writer/.test(normalized)) return "优先确认 creator/media 合作路径和历史商业内容。";
  if (/research|scientist|professor|paper|agi|alignment/.test(normalized)) return "用技术判断和 AI research 语境切入，避免普通投放话术。";
  return "先做账号质量和商业可达性验证，再进入正式合作沟通。";
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

function getPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function clampCount(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (value >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}K`;
  return String(value);
}
