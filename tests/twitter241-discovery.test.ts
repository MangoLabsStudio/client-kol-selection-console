import assert from "node:assert/strict";
import test from "node:test";
import { discoverRootAudienceKolCandidates } from "../server/twitter241DiscoveryService.js";
import type { Twitter241Client, Twitter241Params } from "../server/twitter241.js";

test("twitter241 discovery fetches root followings and people search candidates", async () => {
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
                  rest_id: "root-1",
                  core: { screen_name: "sama", name: "Sam Altman" },
                  legacy: { followers_count: 4_000_000 }
                }
              }
            }
          }
        };
      }
      if (endpoint === "/followings") {
        return {
          timeline: {
            entries: [
              {
                content: {
                  itemContent: {
                    user_results: {
                      result: {
                        rest_id: "candidate-1",
                        core: { screen_name: "agentbuilder", name: "Agent Builder" },
                        legacy: {
                          description: "AI agent builder and developer tools creator.",
                          followers_count: 42000,
                          friends_count: 200,
                          statuses_count: 3000,
                          profile_image_url_https: "https://example.com/agent.jpg"
                        },
                        verification: { verified: true }
                      }
                    }
                  }
                }
              },
              {
                content: {
                  itemContent: {
                    user_results: {
                      result: {
                        rest_id: "root-list-member",
                        core: { screen_name: "karpathy", name: "Andrej Karpathy" },
                        legacy: {
                          description: "AI researcher.",
                          followers_count: 3_000_000
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        };
      }
      if (endpoint === "/search") {
        return {
          result: {
            users: [
              {
                user_results: {
                  result: {
                    rest_id: "candidate-2",
                    core: { screen_name: "ainewsletter", name: "AI Newsletter" },
                    legacy: {
                      description: "Newsletter covering frontier AI products and agent workflows.",
                      followers_count: 73000,
                      friends_count: 120,
                      statuses_count: 1200
                    }
                  }
                }
              }
            ]
          }
        };
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
            { name: "Andrej Karpathy", handle: "@karpathy", role: "AI researcher", status: "pending" }
          ]
        }
      ]
    },
    { client, rootLimit: 1, followingCount: 10, searchCount: 10, maxCandidates: 10 }
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.candidates.some((candidate) => candidate.handle === "agentbuilder"), true);
  assert.equal(result.candidates.some((candidate) => candidate.handle === "ainewsletter"), true);
  assert.equal(result.candidates.some((candidate) => candidate.handle === "karpathy"), false);
  assert.equal(calls.some((call) => call.endpoint === "/user" && call.params.username === "sama"), true);
  assert.equal(calls.some((call) => call.endpoint === "/followings" && call.params.user === "root-1"), true);
  assert.equal(calls.some((call) => call.endpoint === "/search"), true);
  assert.equal(result.metadata.candidateCount, 2);
});

test("twitter241 discovery reports unavailable when no client exists", async () => {
  const result = await discoverRootAudienceKolCandidates({ round: 1, decisions: {}, groups: [] }, { client: null });
  assert.equal(result.status, "unavailable");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.metadata.errors.length, 1);
});
