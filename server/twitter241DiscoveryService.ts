import { createTwitter241ClientFromEnv, type Twitter241Client } from "./twitter241.js";
import type { DiscoveredKolCandidateInput, RootAudienceSnapshotPayload } from "./types.js";

type RootSeed = {
  handle: string;
  name: string;
  role: string;
  groupName: string;
  status: string;
  weight: number;
};

type FlattenedUser = {
  restId: string;
  handle: string;
  name: string;
  description: string;
  followers: number;
  following: number;
  statuses: number;
  listed: number;
  avatarUrl: string;
  verified: boolean;
};

type TargetFollowingRecord = {
  seed: RootSeed;
  status: "ok" | "resolve_failed" | "failed";
  users: FlattenedUser[];
  pagesScanned: number;
  error?: string;
};

type CommonFollowRow = {
  handle: string;
  name: string;
  description: string;
  followers: number;
  following: number;
  statuses: number;
  listed: number;
  avatarUrl: string;
  verified: boolean;
  followedByCount: number;
  coveragePct: number;
  weightedScore: number;
  followedBy: RootSeed[];
  candidateType: string;
  commercialDecision: string;
  scoreHint: number;
};

export type Twitter241DiscoveryResult = {
  provider: "twitter241";
  status: "succeeded" | "partial" | "unavailable" | "failed";
  candidates: DiscoveredKolCandidateInput[];
  metadata: {
    provider: "twitter241";
    strategy: "target_backed_common_follow_v1";
    status: "succeeded" | "partial" | "unavailable" | "failed";
    rootSeeds: Array<Pick<RootSeed, "handle" | "name" | "groupName" | "status" | "weight">>;
    minCoverage: number;
    maxPages: number;
    pageCount: number;
    fetchedUserCount: number;
    rankedAccountCount: number;
    candidateCount: number;
    targetFetchStatus: Array<{ handle: string; status: string; fetchedFollowingsCount: number; pagesScanned: number; error?: string }>;
    errors: string[];
  };
};

export type Twitter241DiscoveryOptions = {
  client?: Twitter241Client | null;
  rootLimit?: number;
  followingCount?: number;
  maxPages?: number;
  minCoverage?: number;
  maxCandidates?: number;
};

export async function discoverRootAudienceKolCandidates(
  snapshot: RootAudienceSnapshotPayload | Record<string, unknown>,
  options: Twitter241DiscoveryOptions = {}
): Promise<Twitter241DiscoveryResult> {
  const client = options.client === undefined ? createTwitter241ClientFromEnv() : options.client;
  const rootSeeds = readRootSeeds(snapshot).slice(0, clampCount(options.rootLimit ?? Number(process.env.TWITTER241_COMMON_FOLLOW_ROOT_LIMIT ?? 10), 1, 24));
  const rootHandleExclusions = readRootHandleExclusions(snapshot);
  const minCoverage = clampCount(options.minCoverage ?? Number(process.env.TWITTER241_COMMON_FOLLOW_MIN_COVERAGE ?? 2), 2, 8);
  const maxPages = clampCount(options.maxPages ?? Number(process.env.TWITTER241_COMMON_FOLLOW_MAX_PAGES ?? 4), 1, 12);
  const pageCount = clampCount(options.followingCount ?? Number(process.env.TWITTER241_COMMON_FOLLOW_PAGE_COUNT ?? 200), 20, 200);
  const maxCandidates = clampCount(options.maxCandidates ?? Number(process.env.TWITTER241_DISCOVERY_MAX_CANDIDATES ?? 80), 10, 200);
  const metadata: Twitter241DiscoveryResult["metadata"] = {
    provider: "twitter241",
    strategy: "target_backed_common_follow_v1",
    status: "unavailable",
    rootSeeds: rootSeeds.map(({ handle, name, groupName, status, weight }) => ({ handle, name, groupName, status, weight })),
    minCoverage,
    maxPages,
    pageCount,
    fetchedUserCount: 0,
    rankedAccountCount: 0,
    candidateCount: 0,
    targetFetchStatus: [],
    errors: []
  };

  if (!client) {
    metadata.errors.push("TWITTER241_RAPIDAPI_KEY is not configured.");
    return { provider: "twitter241", status: "unavailable", candidates: [], metadata };
  }

  if (rootSeeds.length < minCoverage) {
    metadata.errors.push(`Common-follow discovery requires at least ${minCoverage} selected root accounts.`);
    return { provider: "twitter241", status: "unavailable", candidates: [], metadata };
  }

  const records: TargetFollowingRecord[] = [];
  for (const seed of rootSeeds) {
    const record = await fetchRootFollowings(client, seed, rootHandleExclusions, { maxPages, pageCount });
    records.push(record);
    metadata.fetchedUserCount += record.users.length;
    metadata.targetFetchStatus.push({
      handle: seed.handle,
      status: record.status,
      fetchedFollowingsCount: record.users.length,
      pagesScanned: record.pagesScanned,
      error: record.error
    });
    if (record.status !== "ok") metadata.errors.push(`Root ${seed.handle}: ${record.error ?? record.status}`);
  }

  const ranked = aggregateCommonFollowRows(records, rootSeeds, rootHandleExclusions, minCoverage);
  metadata.rankedAccountCount = ranked.length;
  const candidates = ranked.slice(0, maxCandidates).map(rowToCandidate);
  metadata.candidateCount = candidates.length;
  metadata.status = candidates.length > 0 ? (metadata.errors.length > 0 ? "partial" : "succeeded") : metadata.errors.length > 0 ? "failed" : "unavailable";

  return {
    provider: "twitter241",
    status: metadata.status,
    candidates,
    metadata
  };
}

async function fetchRootFollowings(
  client: Twitter241Client,
  seed: RootSeed,
  rootHandleExclusions: Set<string>,
  options: { maxPages: number; pageCount: number }
): Promise<TargetFollowingRecord> {
  try {
    const rootPayload = await client.get("/user", { username: seed.handle });
    const rootProfile = flattenUser(userFromPayload(rootPayload));
    if (!rootProfile.restId) return { seed, status: "resolve_failed", users: [], pagesScanned: 0, error: "Twitter241 did not return a numeric user id." };

    const byHandle = new Map<string, FlattenedUser>();
    let cursor: string | undefined;
    let pagesScanned = 0;
    for (let page = 0; page < options.maxPages; page += 1) {
      const payload = await client.get("/followings", { user: rootProfile.restId, count: options.pageCount, cursor });
      pagesScanned += 1;
      const users = collectUserResults(payload)
        .map(flattenUser)
        .filter((user) => isPotentialNetworkAccount(user, rootHandleExclusions));
      for (const user of users) {
        const existing = byHandle.get(user.handle);
        if (!existing || user.followers > existing.followers) byHandle.set(user.handle, user);
      }
      cursor = extractBottomCursor(payload);
      if (users.length === 0 || !cursor) break;
    }

    return { seed, status: "ok", users: Array.from(byHandle.values()), pagesScanned };
  } catch (error) {
    return {
      seed,
      status: "failed",
      users: [],
      pagesScanned: 0,
      error: error instanceof Error ? error.message : "Twitter241 request failed."
    };
  }
}

function aggregateCommonFollowRows(records: TargetFollowingRecord[], rootSeeds: RootSeed[], rootHandleExclusions: Set<string>, minCoverage: number) {
  const processed = records.filter((record) => record.status === "ok");
  const total = processed.length || 1;
  const rowsByHandle = new Map<
    string,
    {
      user: FlattenedUser;
      followedBy: RootSeed[];
      weightedScore: number;
    }
  >();

  for (const record of processed) {
    const seen = new Set<string>();
    for (const user of record.users) {
      if (!user.handle || seen.has(user.handle) || rootHandleExclusions.has(user.handle)) continue;
      seen.add(user.handle);
      const current = rowsByHandle.get(user.handle);
      if (current) {
        current.followedBy.push(record.seed);
        current.weightedScore += record.seed.weight;
        if (user.followers > current.user.followers) current.user = user;
      } else {
        rowsByHandle.set(user.handle, {
          user,
          followedBy: [record.seed],
          weightedScore: record.seed.weight
        });
      }
    }
  }

  return Array.from(rowsByHandle.entries())
    .map(([handle, value]) => {
      const candidateType = classifyCandidate(value.user, rootHandleExclusions);
      const commercialDecision = commercialDecisionFor(value.user);
      const followedByCount = value.followedBy.length;
      const row: CommonFollowRow = {
        handle,
        name: value.user.name,
        description: value.user.description,
        followers: value.user.followers,
        following: value.user.following,
        statuses: value.user.statuses,
        listed: value.user.listed,
        avatarUrl: value.user.avatarUrl,
        verified: value.user.verified,
        followedByCount,
        coveragePct: Math.round((followedByCount / total) * 1000) / 10,
        weightedScore: Math.round(value.weightedScore * 100) / 100,
        followedBy: sortSeeds(value.followedBy, rootSeeds),
        candidateType,
        commercialDecision,
        scoreHint: scoreCommonFollowCandidate(value.user, value.weightedScore, followedByCount, candidateType, commercialDecision)
      };
      return row;
    })
    .filter((row) => row.followedByCount >= minCoverage)
    .filter((row) => isKolLikeCommonFollow(row))
    .sort((a, b) => b.scoreHint - a.scoreHint || b.weightedScore - a.weightedScore || b.followedByCount - a.followedByCount || b.followers - a.followers);
}

function rowToCandidate(row: CommonFollowRow): DiscoveredKolCandidateInput {
  const followedByHandles = row.followedBy.map((seed) => `@${seed.handle}`);
  const followedByPeople = row.followedBy.map((seed) => seed.name || `@${seed.handle}`).slice(0, 8);
  return {
    handle: row.handle,
    name: row.name || row.handle,
    platform: "X",
    profileUrl: `https://x.com/${row.handle}`,
    avatarUrl: row.avatarUrl,
    bio: row.description,
    followers: row.followers,
    region: "Global",
    language: "EN",
    contentCategory: inferContentCategory(`${row.name} ${row.description}`),
    audienceSummary: `被 ${row.followedByCount} 个目标 root 共同关注（覆盖 ${row.coveragePct}%）：${followedByPeople.join("、")}。`,
    whyIncluded: `来自目标人群共同关注网络，不是单个账号 followings：${followedByHandles.slice(0, 12).join("、")} 共同关注。`,
    recommendedAngle: inferRecommendedAngle(`${row.name} ${row.description}`, row.commercialDecision),
    contactStatus: inferContactStatus(row.description),
    riskTags: riskTagsFor(row),
    scoreHint: row.scoreHint,
    source: "twitter241_common_follow",
    sourceRootHandle: `${row.followedByCount} common roots`,
    metadata: {
      discoverySource: "target_backed_common_follow_v1",
      candidateType: row.candidateType,
      commercialDecision: row.commercialDecision,
      followedByCount: row.followedByCount,
      coveragePct: row.coveragePct,
      weightedScore: row.weightedScore,
      followedByHandles,
      followedByPeople,
      listed: row.listed,
      verified: row.verified,
      following: row.following,
      statuses: row.statuses
    }
  };
}

function scoreCommonFollowCandidate(user: FlattenedUser, weightedScore: number, followedByCount: number, candidateType: string, commercialDecision: string) {
  const text = `${user.name} ${user.description}`.toLowerCase();
  let score = 35;
  score += weightedScore * 14;
  score += followedByCount * 8;
  score += Math.min(18, Math.log10(Math.max(user.followers, 1)) * 3.5);
  if (user.verified) score += 3;
  if (user.listed > 1000) score += 3;
  if (/newsletter|podcast|youtube|creator|writer|media|educator|curator|community|course|sponsor|advertise|partnership/.test(text)) score += 18;
  if (/agent|ai|agi|llm|machine learning|developer|builder|product|founder|startup|research/.test(text)) score += 10;
  if (/投资|vc|venture|investor|fund/.test(candidateType.toLowerCase())) score -= 4;
  if (commercialDecision === "High") score += 12;
  if (commercialDecision === "Medium-DM") score += 8;
  if (commercialDecision === "Medium-Partner") score -= 2;
  if (commercialDecision === "Remove") score -= 40;
  if (isInstitutionAccount(user)) score -= 30;
  return Math.round(Math.max(0, Math.min(score, 120)) * 100) / 100;
}

function isKolLikeCommonFollow(row: CommonFollowRow) {
  if (!row.handle || row.followers < 2_000) return false;
  if (row.commercialDecision === "Remove") return false;
  if (isInstitutionAccount(row)) return false;
  const text = `${row.name} ${row.description} ${row.candidateType}`.toLowerCase();
  const hasKolSurface = /newsletter|podcast|youtube|creator|writer|media|educator|curator|community|course|sponsor|advertise|partnership|consulting|dm/.test(text);
  const hasRelevantIndividual = /agent|ai|agi|llm|machine learning|developer|builder|product|founder|startup|research|vc|venture|investor/.test(text);
  return hasKolSurface || (hasRelevantIndividual && row.followedByCount >= 3);
}

function classifyCandidate(user: FlattenedUser, rootHandleExclusions: Set<string>) {
  const handle = user.handle.toLowerCase();
  const text = `${user.name} ${user.description}`.toLowerCase();
  if (rootHandleExclusions.has(handle)) return "目标人本人";
  if (isInstitutionAccount(user)) return "机构/产品账号";
  if (/newsletter|podcast|youtube|creator|writer|media|journalist|editor|curator|educator|community|course/.test(text)) return "AI 媒体 / Creator";
  if (/vc|venture|investor|capital|partner|fund/.test(text)) return "投资/创业圈";
  if (/agent|builder|developer|engineer|product|founder|startup/.test(text)) return "Agent Builder / Founder";
  if (/research|professor|phd|scientist|lab|faculty|paper|agi|alignment/.test(text)) return "研究者 / 技术专家";
  if (/ai|machine learning|deep learning|llm|foundation model/.test(text)) return "AI 技术圈";
  return "待人工判断";
}

function commercialDecisionFor(user: FlattenedUser) {
  const text = `${user.name} ${user.description}`.toLowerCase();
  if (isInstitutionAccount(user)) return "Remove";
  if (/sponsor|advertise|media kit|work with|partnership|business inquiries|dm for collabs|collabs|booking|newsletter|podcast|youtube|course|community/.test(text)) {
    return "High";
  }
  if (/creator|writer|curator|educator|consultant|indie|solo|build in public|tools|product reviews|startup ideas/.test(text)) return "Medium-DM";
  if (/vc|venture|investor|capital|partner|researcher|scientist|professor|journalist|editor|big tech|openai|anthropic|deepmind|google|microsoft|meta/.test(text)) {
    return "Medium-Partner";
  }
  return "Low";
}

function riskTagsFor(row: CommonFollowRow) {
  const tags: string[] = [];
  if (row.commercialDecision === "Medium-Partner") tags.push("需 warm intro");
  if (/投资|研究|技术专家|机构/.test(row.candidateType)) tags.push("非直接 paid post");
  if (row.followedByCount < 3) tags.push("覆盖待验证");
  return tags;
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
        status,
        weight: seedWeight(status, groupName)
      });
    }
  }

  const statusRank = { approved: 0, question: 1, pending: 2, rejected: 3 } as Record<string, number>;
  return seeds.sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || b.weight - a.weight || a.handle.localeCompare(b.handle));
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

function seedWeight(status: string, groupName: string) {
  const base = status === "approved" ? 3 : status === "question" ? 1.4 : 0.6;
  if (/行业|超级|大佬|vc|投资|垂类|专家|核心/i.test(groupName)) return base;
  return Math.max(1, base - 0.3);
}

function sortSeeds(seeds: RootSeed[], allSeeds: RootSeed[]) {
  const order = new Map(allSeeds.map((seed, index) => [seed.handle, index]));
  return [...seeds].sort((a, b) => (order.get(a.handle) ?? 999) - (order.get(b.handle) ?? 999));
}

function isPotentialNetworkAccount(user: FlattenedUser, rootHandleExclusions: Set<string>) {
  if (!user.handle || rootHandleExclusions.has(user.handle)) return false;
  if (user.handle.length > 32 || /[^a-z0-9_]/i.test(user.handle)) return false;
  return user.followers >= 1_000;
}

function isInstitutionAccount(user: Pick<FlattenedUser, "name" | "description" | "handle">) {
  const text = `${user.name} ${user.description}`.toLowerCase();
  const handle = user.handle.toLowerCase();
  const institutionSignals = /official|foundation|protocol|company|platform|team|labs\b|lab\b|research group|university|institute|capital|ventures|studio|corp|inc\.|inc |dao\b/.test(text);
  const individualSignals = /founder|creator|writer|podcast|newsletter|youtube|engineer|researcher|scientist|investor|partner|professor|builder|educator|curator|consultant/.test(text);
  if (individualSignals) return false;
  if (institutionSignals) return true;
  return /^(openai|anthropicai|googledeepmind|deepmind|microsoft|metaai|nvidia|a16z|sequoia|ycombinator|huggingface|vercel|github)$/i.test(handle);
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
    listed: Number(legacy.listed_count ?? user.listed_count ?? 0),
    avatarUrl,
    verified: Boolean(verification.verified ?? legacy.verified ?? user.verified ?? false)
  };
}

function looksLikeUser(value: Record<string, unknown>) {
  return Boolean((value.rest_id || value.id || value.id_str) && (value.core || value.legacy || value.username || value.screen_name));
}

function inferContentCategory(text: string) {
  const normalized = text.toLowerCase();
  if (/newsletter|podcast|media|creator|youtube|writer|curator/.test(normalized)) return "AI Media / Creator";
  if (/vc|venture|investor|fund|startup/.test(normalized)) return "VC / Founder Network";
  if (/research|scientist|professor|paper|agi|alignment/.test(normalized)) return "AI Research";
  if (/agent|builder|engineer|developer|product|tool/.test(normalized)) return "Agent Builder";
  return "Broad AI";
}

function inferContactStatus(text: string) {
  const normalized = text.toLowerCase();
  if (/sponsor|partnership|booking|speaking|advertise|newsletter|podcast|media kit|dm|business inquiries|collabs/.test(normalized)) return "商业路径待验证";
  return "需 BD 验证";
}

function inferRecommendedAngle(text: string, commercialDecision: string) {
  const normalized = text.toLowerCase();
  if (commercialDecision === "High") return "优先验证 sponsor / partnership 路径，可作为主发或长内容合作候选。";
  if (/newsletter|podcast|media|creator|youtube|writer/.test(normalized)) return "先确认 newsletter / podcast / creator 合作库存，再判断是否主发。";
  if (/vc|venture|investor|fund|startup/.test(normalized)) return "不要按普通 paid post 谈，优先走 warm intro、播客、newsletter 或 founder 内容合作。";
  if (/research|scientist|professor|paper|agi|alignment/.test(normalized)) return "用技术交流、demo、圆桌或研究语境触达，不做硬广。";
  return "先做账号质量和商务可达性验证，再进入正式合作沟通。";
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
