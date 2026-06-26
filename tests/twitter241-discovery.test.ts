import assert from "node:assert/strict";
import test from "node:test";
import { discoverRootAudienceKolCandidates } from "../server/twitter241DiscoveryService.js";
import type { Twitter241Client, Twitter241Params } from "../server/twitter241.js";

function user(restId: string, handle: string, name: string, description: string, followers: number) {
  return {
    rest_id: restId,
    core: { screen_name: handle, name },
    legacy: {
      description,
      followers_count: followers,
      friends_count: 200,
      statuses_count: 3000,
      listed_count: 120,
      profile_image_url_https: `https://example.com/${handle}.jpg`
    },
    verification: { verified: true }
  };
}

function followingsPayload(users: Array<ReturnType<typeof user>>) {
  return {
    result: {
      timeline: {
        instructions: [
          {
            entries: users.map((item, index) => ({
              entryId: `user-${index}`,
              content: {
                itemContent: {
                  user_results: {
                    result: item
                  }
                }
              }
            }))
          }
        ]
      }
    }
  };
}

test("twitter241 discovery builds a KOL universe then filters by selected root audience", async () => {
  const calls: Array<{ endpoint: string; params: Twitter241Params }> = [];
  const client: Twitter241Client = {
    async get(endpoint, params) {
      calls.push({ endpoint, params });
      if (endpoint === "/user") {
        const username = String(params.username);
        return {
          result: {
            data: {
              user: {
                result: user(`root-${username}`, username, username, "root account", 4_000_000)
              }
            }
          }
        };
      }
      if (endpoint === "/followings") {
        const rootId = String(params.user);
        if (rootId === "root-sama") {
          return followingsPayload([
            user("candidate-common", "agentnewsletter", "Agent Newsletter", "AI agent newsletter, podcast, and sponsor partnerships.", 73_000),
            user("candidate-single", "samaonly", "Sama Only", "AI founder with no shared coverage.", 90_000),
            user("root-list-member", "karpathy", "Andrej Karpathy", "AI researcher.", 3_000_000)
          ]);
        }
        if (rootId === "root-pmarca") {
          return followingsPayload([
            user("candidate-common", "agentnewsletter", "Agent Newsletter", "AI agent newsletter, podcast, and sponsor partnerships.", 73_000),
            user("candidate-unselected-common", "pmarcaonlycommon", "PMarca Network", "AI podcast, newsletter, and sponsor partnerships.", 81_000),
            user("candidate-official", "openai", "OpenAI", "Official company account.", 5_000_000)
          ]);
        }
        if (rootId === "root-karpathy") {
          return followingsPayload([
            user("candidate-unselected-common", "pmarcaonlycommon", "PMarca Network", "AI podcast, newsletter, and sponsor partnerships.", 81_000),
            user("candidate-research", "airesearchonly", "AI Research Only", "AI research notes without selected root coverage.", 66_000)
          ]);
        }
      }
      throw new Error(`unexpected endpoint ${endpoint}`);
    }
  };

  const result = await discoverRootAudienceKolCandidates(
    {
      round: 1,
      decisions: { "@sama": { status: "approved" } },
      groups: [
        {
          name: "行业超级大佬",
          people: [
            { name: "Sam Altman", handle: "@sama", role: "OpenAI", status: "approved" },
            { name: "Marc Andreessen", handle: "@pmarca", role: "VC", status: "pending" },
            { name: "Andrej Karpathy", handle: "@karpathy", role: "AI researcher", status: "pending" }
          ]
        }
      ]
    },
    { client, rootLimit: 3, followingCount: 10, maxPages: 1, minCoverage: 2, selectedMinCoverage: 1, maxCandidates: 10 }
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.metadata.strategy, "kol_universe_then_root_filter_v1");
  assert.equal(result.metadata.rootSeeds.length, 3);
  assert.equal(result.metadata.selectedRootSeeds.length, 1);
  assert.equal(result.metadata.universeAccountCount, 2);
  assert.equal(result.metadata.filteredAccountCount, 1);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.ok(candidate);
  assert.ok(candidate.metadata);
  assert.equal(candidate.handle, "agentnewsletter");
  assert.equal(candidate.source, "twitter241_kol_universe_filter");
  assert.equal(candidate.metadata.universeFollowedByCount, 2);
  assert.equal(candidate.metadata.selectedFollowedByCount, 1);
  assert.equal(result.candidates.some((candidate) => candidate.handle === "samaonly"), false);
  assert.equal(result.candidates.some((candidate) => candidate.handle === "pmarcaonlycommon"), false);
  assert.equal(result.candidates.some((candidate) => candidate.handle === "karpathy"), false);
  assert.equal(calls.filter((call) => call.endpoint === "/user").length, 3);
  assert.equal(calls.filter((call) => call.endpoint === "/followings").length, 3);
  assert.equal(calls.some((call) => call.endpoint === "/search" || call.endpoint === "/search-v2"), false);
});

test("twitter241 discovery requires at least one selected root", async () => {
  const client: Twitter241Client = {
    async get() {
      throw new Error("should not call twitter241");
    }
  };
  const result = await discoverRootAudienceKolCandidates(
    {
      round: 1,
      decisions: {},
      groups: [
        {
          name: "行业超级大佬",
          people: [
            { name: "Sam Altman", handle: "@sama", role: "OpenAI", status: "pending" },
            { name: "Marc Andreessen", handle: "@pmarca", role: "VC", status: "pending" }
          ]
        }
      ]
    },
    { client, minCoverage: 2 }
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.metadata.errors[0]?.includes("at least 1"), true);
});

test("twitter241 discovery reports unavailable when no client exists", async () => {
  const result = await discoverRootAudienceKolCandidates({ round: 1, decisions: {}, groups: [] }, { client: null });
  assert.equal(result.status, "unavailable");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.metadata.errors.length, 1);
});
