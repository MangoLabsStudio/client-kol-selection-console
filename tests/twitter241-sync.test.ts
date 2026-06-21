import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../server/db.js";
import { seedDemoData } from "../server/seed.js";
import { syncCampaignTwitter241 } from "../server/twitter241SyncService.js";
import type { Twitter241Client, Twitter241Params } from "../server/twitter241.js";

const campaignId = "campaign-ilands-root-backed-kol-review";

function withDb(run: (db: DatabaseSync) => Promise<void> | void) {
  const db = createDatabase({ dbPath: ":memory:" });
  return Promise.resolve(run(db)).finally(() => db.close());
}

test("twitter241 sync resolves numeric user id before timeline fetch and preserves live metadata across seed sync", async () => {
  await withDb(async (db) => {
    const calls: Array<{ endpoint: string; params: Twitter241Params }> = [];
    const client: Twitter241Client = {
      async get(endpoint, params) {
        calls.push({ endpoint, params });
        if (endpoint === "/user") {
          return {
            result: {
              data: {
                user: {
                  result: {
                    rest_id: "12345",
                    core: { screen_name: "rohanpaul_ai", name: "Rohan Paul" },
                    legacy: {
                      description: "AI systems and research notes.",
                      followers_count: 123456,
                      friends_count: 11,
                      listed_count: 22,
                      statuses_count: 3333,
                      profile_image_url_https: "https://example.com/avatar.jpg"
                    },
                    verification: { verified: true }
                  }
                }
              }
            }
          };
        }
        if (endpoint === "/user-tweets") {
          return {
            result: {
              timeline: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "tweet-1",
                                legacy: {
                                  full_text: "Original AI infra post",
                                  favorite_count: 10,
                                  retweet_count: 2,
                                  quote_count: 1,
                                  reply_count: 3,
                                  bookmark_count: 4
                                }
                              }
                            }
                          }
                        }
                      },
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "tweet-2",
                                legacy: {
                                  full_text: "RT @someone: reposted item",
                                  favorite_count: 50,
                                  retweet_count: 1,
                                  quote_count: 0,
                                  reply_count: 0,
                                  bookmark_count: 0
                                }
                              }
                            }
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }
          };
        }
        throw new Error(`unexpected endpoint ${endpoint}`);
      }
    };

    const result = await syncCampaignTwitter241(db, campaignId, {
      client,
      handles: ["rohanpaul_ai"],
      tweetCount: 2,
      syncedAt: "2026-06-21T00:00:00.000Z"
    });

    assert.equal(result.updated, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.results.find((item) => item.handle === "rohanpaul_ai")?.followersAfter, 123456);
    assert.equal(calls.find((call) => call.endpoint === "/user-tweets")?.params.user, "12345");

    const profile = db.prepare("SELECT followers, metadata FROM kol_profiles WHERE id = ?").get("kol-rohanpaul-ai");
    assert.equal(profile?.followers, 123456);
    assert.equal(JSON.parse(String(profile?.metadata)).twitter241.restId, "12345");

    const item = db.prepare("SELECT metadata FROM campaign_kol_items WHERE id = ?").get("item-kol-rohanpaul-ai");
    const itemMetadata = JSON.parse(String(item?.metadata));
    assert.equal(itemMetadata.poolScaleStatus, "confirmed");
    assert.equal(itemMetadata.twitter241.timeline.sampledTweets, 2);
    assert.equal(itemMetadata.twitter241.timeline.originalTweets, 1);
    assert.equal(itemMetadata.twitter241.timeline.retweetsExcluded, 1);

    seedDemoData(db);

    const profileAfterSeed = db.prepare("SELECT followers, metadata FROM kol_profiles WHERE id = ?").get("kol-rohanpaul-ai");
    assert.equal(profileAfterSeed?.followers, 123456);
    assert.equal(JSON.parse(String(profileAfterSeed?.metadata)).twitter241.restId, "12345");
  });
});
