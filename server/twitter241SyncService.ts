import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "./types.js";
import { createTwitter241ClientFromEnv, type Twitter241Client } from "./twitter241.js";

type Row = Record<string, unknown>;

export type Twitter241SyncOptions = {
  client?: Twitter241Client;
  handles?: string[];
  tweetCount?: number;
  syncedAt?: string;
};

export type Twitter241SyncItemResult = {
  itemId: string;
  kolId: string;
  handle: string;
  status: "updated" | "skipped" | "resolve_failed" | "failed";
  followersBefore?: number;
  followersAfter?: number;
  sampledTweets?: number;
  originalTweets?: number;
  retweetsExcluded?: number;
  error?: string;
};

export type Twitter241SyncResult = {
  campaignId: string;
  provider: "twitter241";
  syncedAt: string;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  results: Twitter241SyncItemResult[];
};

export async function syncCampaignTwitter241(db: DatabaseSync, campaignId: string, options: Twitter241SyncOptions = {}): Promise<Twitter241SyncResult> {
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new ApiError(404, "未找到该项目。");

  const client = options.client ?? createTwitter241ClientFromEnv();
  if (!client) throw new ApiError(503, "Twitter241 API 尚未配置：请设置 TWITTER241_RAPIDAPI_KEY。");

  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const tweetCount = clampTweetCount(options.tweetCount ?? Number(process.env.TWITTER241_SYNC_TWEET_COUNT ?? 20));
  const handleFilter = new Set((options.handles ?? []).map(normalizeHandle).filter(Boolean));

  const rows = db
    .prepare(
      `SELECT
        i.id AS item_id,
        i.metadata AS item_metadata,
        p.id AS kol_id,
        p.handle,
        p.platform,
        p.profile_url,
        p.avatar_url,
        p.bio,
        p.followers,
        p.metadata AS kol_metadata
      FROM campaign_kol_items i
      JOIN kol_profiles p ON p.id = i.kol_id
      WHERE i.campaign_id = ?
      ORDER BY i.display_order ASC`
    )
    .all(campaignId) as Row[];

  const results: Twitter241SyncItemResult[] = [];
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const itemId = String(row.item_id);
    const kolId = String(row.kol_id);
    const handle = normalizeHandle(String(row.handle ?? ""));
    const baseResult = { itemId, kolId, handle };

    if (!handle || !isTwitterCandidate(row)) {
      skipped += 1;
      results.push({ ...baseResult, status: "skipped" });
      continue;
    }

    if (handleFilter.size > 0 && !handleFilter.has(handle)) {
      skipped += 1;
      continue;
    }

    try {
      const profilePayload = await client.get("/user", { username: handle });
      const user = userFromPayload(profilePayload);
      const profile = flattenProfile(user);

      if (!profile.restId) {
        failed += 1;
        results.push({ ...baseResult, status: "resolve_failed", error: "Twitter241 did not return a numeric user id." });
        updateItemTwitter241Metadata(db, row, {
          syncedAt,
          status: "resolve_failed",
          handle,
          error: "Twitter241 did not return a numeric user id."
        });
        continue;
      }

      const timeline = tweetCount > 0 ? await fetchTimelineSummary(client, profile.restId, tweetCount) : emptyTimelineSummary();
      const followersBefore = Number(row.followers ?? 0);
      const followersAfter = profile.followersCount || followersBefore;
      const profileUrl = profile.screenName ? `https://x.com/${profile.screenName}` : String(row.profile_url ?? "");
      const twitter241 = {
        syncedAt,
        status: "ok",
        restId: profile.restId,
        screenName: profile.screenName || handle,
        name: profile.name,
        followersCount: followersAfter,
        friendsCount: profile.friendsCount,
        listedCount: profile.listedCount,
        statusesCount: profile.statusesCount,
        verified: profile.verified,
        profileUrl,
        timeline
      };

      updateProfile(db, row, {
        followers: followersAfter,
        bio: profile.description || String(row.bio ?? ""),
        avatarUrl: profile.avatarUrl || String(row.avatar_url ?? ""),
        profileUrl,
        twitter241,
        syncedAt
      });
      updateItemTwitter241Metadata(db, row, {
        ...twitter241,
        poolScaleStatus: "confirmed",
        poolScaleSource: "twitter241"
      });

      updated += 1;
      results.push({
        ...baseResult,
        status: "updated",
        followersBefore,
        followersAfter,
        sampledTweets: timeline.sampledTweets,
        originalTweets: timeline.originalTweets,
        retweetsExcluded: timeline.retweetsExcluded
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Twitter241 sync failed.";
      failed += 1;
      results.push({ ...baseResult, status: "failed", error: message });
      updateItemTwitter241Metadata(db, row, {
        syncedAt,
        status: "failed",
        handle,
        error: message
      });
    }
  }

  return {
    campaignId,
    provider: "twitter241",
    syncedAt,
    total: rows.length,
    updated,
    skipped,
    failed,
    results
  };
}

function updateProfile(
  db: DatabaseSync,
  row: Row,
  input: {
    followers: number;
    bio: string;
    avatarUrl: string;
    profileUrl: string;
    twitter241: Record<string, unknown>;
    syncedAt: string;
  }
) {
  const metadata = {
    ...readJsonObject(row.kol_metadata),
    twitter241: input.twitter241
  };

  db
    .prepare(
      `UPDATE kol_profiles
      SET followers = ?,
        bio = ?,
        avatar_url = ?,
        profile_url = ?,
        metadata = ?,
        updated_at = ?
      WHERE id = ?`
    )
    .run(input.followers, input.bio, input.avatarUrl, input.profileUrl, JSON.stringify(metadata), input.syncedAt, String(row.kol_id));
}

function updateItemTwitter241Metadata(db: DatabaseSync, row: Row, twitter241: Record<string, unknown>) {
  const metadata = {
    ...readJsonObject(row.item_metadata),
    poolScaleStatus: twitter241.poolScaleStatus ?? (twitter241.status === "ok" ? "confirmed" : "needs_review"),
    poolScaleSource: "twitter241",
    poolScaleSyncedAt: twitter241.syncedAt,
    twitter241
  };

  db.prepare("UPDATE campaign_kol_items SET metadata = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(metadata),
    String(twitter241.syncedAt ?? new Date().toISOString()),
    String(row.item_id)
  );
}

async function fetchTimelineSummary(client: Twitter241Client, restId: string, count: number) {
  const payload = await client.get("/user-tweets", { user: restId, count });
  const tweets = collectTweetResults(payload).map(extractTweet).filter((tweet): tweet is ExtractedTweet => Boolean(tweet));
  const retweetsExcluded = tweets.filter((tweet) => tweet.isRetweet).length;
  const originalTweets = tweets.length - retweetsExcluded;

  return {
    sampledTweets: tweets.length,
    originalTweets,
    retweetsExcluded,
    topOriginalTweets: tweets
      .filter((tweet) => !tweet.isRetweet)
      .sort((a, b) => b.publicEngagementScore - a.publicEngagementScore)
      .slice(0, 5)
  };
}

function emptyTimelineSummary() {
  return {
    sampledTweets: 0,
    originalTweets: 0,
    retweetsExcluded: 0,
    topOriginalTweets: [] as ExtractedTweet[]
  };
}

type ExtractedTweet = {
  tweetId: string;
  text: string;
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  bookmarks: number;
  publicEngagementScore: number;
  isRetweet: boolean;
};

function extractTweet(tweet: Record<string, unknown>): ExtractedTweet | null {
  const legacy = tweetLegacy(tweet);
  const tweetId = String(tweet.rest_id ?? legacy.id_str ?? "");
  const text = String(legacy.full_text ?? legacy.text ?? "");
  if (!tweetId || !text) return null;

  const likes = Number(legacy.favorite_count ?? 0);
  const retweets = Number(legacy.retweet_count ?? 0);
  const quotes = Number(legacy.quote_count ?? 0);
  const replies = Number(legacy.reply_count ?? 0);
  const bookmarks = Number(legacy.bookmark_count ?? 0);

  return {
    tweetId,
    text: text.replace(/\s+/g, " ").trim().slice(0, 420),
    likes,
    retweets,
    quotes,
    replies,
    bookmarks,
    publicEngagementScore: likes + 2 * retweets + 2 * quotes + replies + bookmarks,
    isRetweet: text.startsWith("RT @") || Boolean(legacy.retweeted_status_result)
  };
}

function tweetLegacy(tweet: Record<string, unknown>): Record<string, unknown> {
  const innerTweet = readObject(tweet.tweet) ?? tweet;
  return readObject(innerTweet.legacy) ?? readObject(getPath(innerTweet, ["quoted_status_result", "result", "legacy"])) ?? {};
}

function collectTweetResults(payload: unknown) {
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    const objectValue = value as Record<string, unknown>;
    const result = readObject(getPath(objectValue, ["tweet_results", "result"]));
    const tweetId = result ? String(result.rest_id ?? "") : "";
    if (result && tweetId && !seen.has(tweetId) && result.__typename !== "TweetTombstone") {
      seen.add(tweetId);
      results.push(result);
    }

    Object.values(objectValue).forEach(visit);
  }

  visit(payload);
  return results;
}

function userFromPayload(payload: unknown): Record<string, unknown> {
  return readObject(getPath(payload, ["result", "data", "user", "result"])) ?? {};
}

function flattenProfile(user: Record<string, unknown>) {
  const core = readObject(user.core) ?? {};
  const legacy = readObject(user.legacy) ?? {};
  const verification = readObject(user.verification) ?? {};

  return {
    restId: String(user.rest_id ?? ""),
    screenName: String(core.screen_name ?? legacy.screen_name ?? ""),
    name: String(core.name ?? legacy.name ?? ""),
    description: String(legacy.description ?? ""),
    followersCount: Number(legacy.followers_count ?? 0),
    friendsCount: Number(legacy.friends_count ?? 0),
    listedCount: Number(legacy.listed_count ?? 0),
    statusesCount: Number(legacy.statuses_count ?? 0),
    avatarUrl: String(legacy.profile_image_url_https ?? legacy.profile_image_url ?? ""),
    verified: Boolean(verification.verified ?? legacy.verified ?? false)
  };
}

function isTwitterCandidate(row: Row) {
  const platform = String(row.platform ?? "").toLowerCase();
  const profileUrl = String(row.profile_url ?? "").toLowerCase();
  return platform.includes("x") || platform.includes("twitter") || profileUrl.includes("x.com") || profileUrl.includes("twitter.com");
}

function normalizeHandle(value: string) {
  let handle = value.trim();
  if (!handle) return "";
  handle = handle.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  handle = handle.split(/[/?#]/)[0] ?? "";
  return handle.replace(/^@/, "").trim().toLowerCase();
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

function clampTweetCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), 80);
}
