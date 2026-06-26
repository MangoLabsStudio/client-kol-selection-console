import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../server/db.js";
import { getClientAppConfig, getProjectConfig } from "../server/projectConfig.js";
import { seedDemoData } from "../server/seed.js";
import {
  createClientActionEvent,
  createKolGenerationRun,
  createRootAudienceSnapshot,
  createSelectionEvent,
  exportSelection,
  getCampaignBoard,
  getClientActionEvents,
  getGenerationRuns,
  getLatestRootAudienceSnapshot,
  getSelectionHistory,
  lockSelection
} from "../server/selectionService.js";
import { ApiError } from "../server/types.js";

const campaignId = "campaign-ilands-root-backed-kol-review";

function withDb(run: (db: DatabaseSync) => void) {
  const db = createDatabase({ dbPath: ":memory:" });
  try {
    run(db);
  } finally {
    db.close();
  }
}

function insertRootKolEdge(
  db: DatabaseSync,
  input: {
    rootHandle: string;
    rootName: string;
    rootGroup: string;
    itemId: string;
    kolId: string;
    kolHandle: string;
    confidence?: number;
  }
) {
  const timestamp = "2026-06-26T00:00:00.000Z";
  db.prepare(
    `INSERT INTO root_kol_edges (
      id, client_id, campaign_id, root_handle, root_name, root_group,
      campaign_kol_item_id, kol_id, kol_handle, edge_type, edge_source,
      confidence, evidence, metadata, fetched_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, root_handle, campaign_kol_item_id, edge_source) DO UPDATE SET
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at`
  ).run(
    `test-edge-${input.rootHandle.replace(/^@/, "")}-${input.itemId}`,
    "client-ilands",
    campaignId,
    input.rootHandle,
    input.rootName,
    input.rootGroup,
    input.itemId,
    input.kolId,
    input.kolHandle,
    "twitter_following",
    "twitter241_followings",
    input.confidence ?? 0.95,
    `${input.rootHandle} follows ${input.kolHandle}.`,
    "{}",
    timestamp,
    timestamp,
    timestamp
  );
}

test("loads the seeded campaign board with current-state summary", () => {
  withDb((db) => {
    const board = getCampaignBoard(db, campaignId, "client");

    assert.equal(board.campaign.clientName, "iLands");
    assert.equal(board.campaign.name, "iLands Root-backed KOL 候选评审");
    assert.equal(board.items.length, 107);
    assert.deepEqual(board.summary, {
      total: 107,
      pending: 107,
      approved: 0,
      rejected: 0,
      question: 0,
      hold: 0
    });
  });
});

test("loads project config for project-specific UI and seed data", () => {
  const config = getProjectConfig("ilands-aaa-signal-map");
  const appConfig = getClientAppConfig("ilands-aaa-signal-map");

  assert.equal(config.client.name, "iLands");
  assert.equal(config.templateId, "ilands-root-backed-kol-review");
  assert.equal(config.campaign.id, campaignId);
  assert.equal(config.ui.brand.name, "iLands KOL Selection Console");
  assert.equal(config.seed.candidates.length, 107);
  assert.equal(config.ui.roots?.groups.length, 3);
  assert.equal(appConfig.templateId, "ilands-root-backed-kol-review");
  assert.equal(appConfig.campaignId, campaignId);
  assert.equal(appConfig.availableProjects.some((project) => project.projectId === "ilands-aaa-signal-map"), true);
});

test("reject requires at least one reason tag", () => {
  withDb((db) => {
    assert.throws(
      () =>
        createSelectionEvent(db, {
          campaignId,
          itemId: "item-kol-rohanpaul-ai",
          actorId: "client-reviewer-1",
          actorRole: "client",
          toStatus: "rejected",
          decision: "rejected",
          reasonTags: [],
          note: "No reason selected",
          clientRequestId: "reject-without-reason"
        }),
      (error) => error instanceof ApiError && error.status === 400 && /排除原因/.test(error.message)
    );
  });
});

test("seed sync refreshes candidate copy without overwriting real review decisions", () => {
  withDb((db) => {
    const config = getProjectConfig("ilands-aaa-signal-map");
    const rohan = config.seed.candidates.find((candidate) => candidate.itemId === "item-kol-rohanpaul-ai");

    db
      .prepare("UPDATE campaign_kol_items SET client_facing_note = ? WHERE id = ?")
      .run("Old imported copy.", "item-kol-rohanpaul-ai");

    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-rohanpaul-ai",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "rejected",
      decision: "rejected",
      reasonTags: ["brand_fit_mismatch"],
      note: "客户后续评审备注，不应被 seed 覆盖。",
      clientRequestId: "real-client-decision"
    });

    seedDemoData(db);

    const board = getCampaignBoard(db, campaignId, "client");
    const item = board.items.find((candidate) => candidate.id === "item-kol-rohanpaul-ai");

    assert.equal(item?.clientFacingNote, rohan?.clientFacingNote);
    assert.equal(item?.currentState.currentNote, "客户后续评审备注，不应被 seed 覆盖。");
  });
});

test("seed sync inserts newly added candidates into an existing campaign", () => {
  withDb((db) => {
    db.prepare("DELETE FROM campaign_kol_items WHERE id = ?").run("item-kol-jonerlichman");

    let board = getCampaignBoard(db, campaignId, "client");
    assert.equal(board.items.length, 106);
    assert.equal(board.items.some((item) => item.id === "item-kol-jonerlichman"), false);

    seedDemoData(db);

    board = getCampaignBoard(db, campaignId, "client");
    const restored = board.items.find((item) => item.id === "item-kol-jonerlichman");
    assert.equal(board.items.length, 107);
    assert.equal(restored?.kol.handle, "@jonerlichman");
    assert.equal(restored?.currentState.currentStatus, "pending");
  });
});

test("reject writes event log, current state, and summary", () => {
  withDb((db) => {
    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-trungtphan",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "rejected",
      decision: "rejected",
      reasonTags: ["brand_fit_mismatch", "too_niche"],
      note: "Good creator, but not the right launch frame.",
      clientRequestId: "reject-mira"
    });

    assert.equal(result.currentState.currentStatus, "rejected");
    assert.deepEqual(result.currentState.currentReasonTags, ["brand_fit_mismatch", "too_niche"]);
    assert.equal(result.summary.pending, 106);
    assert.equal(result.summary.rejected, 1);

    const history = getSelectionHistory(db, campaignId, "item-kol-trungtphan");
    assert.equal(history.length, 1);
    assert.equal(history[0].eventType, "decision_created");
  });
});

test("question creates an open follow-up task", () => {
  withDb((db) => {
    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-latentspacepod",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "question",
      decision: "question",
      reasonTags: ["need_price", "need_case_sample"],
      note: "Please confirm price and a relevant founder-interview sample.",
      clientRequestId: "question-theo"
    });

    assert.equal(result.currentState.currentStatus, "question");
    assert.equal(result.summary.question, 1);

    const followup = db
      .prepare("SELECT * FROM kol_selection_followups WHERE campaign_kol_item_id = ? AND created_from_event_id = ?")
      .get("item-kol-latentspacepod", result.event.id);
    assert.equal(followup?.status, "open");
    assert.equal(followup?.task_type, "need_price");
  });
});

test("changing a rejected KOL to approved appends a new event", () => {
  withDb((db) => {
    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-aibreakfast",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "rejected",
      decision: "rejected",
      reasonTags: ["too_generic"],
      note: "更适合二波放量，先不进入第一波。",
      clientRequestId: "reject-aibreakfast"
    });

    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-aibreakfast",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "approved",
      decision: "approved",
      reasonTags: ["priority_fit"],
      note: "如果需要 newsletter inclusion，可进入二波。",
      clientRequestId: "change-aibreakfast"
    });

    assert.equal(result.currentState.currentStatus, "approved");
    assert.equal(result.event.eventType, "decision_changed");
    assert.equal(result.event.fromStatus, "rejected");

    const history = getSelectionHistory(db, campaignId, "item-kol-aibreakfast");
    const originalReject = history.find((event) => event.eventType === "decision_created" && event.toStatus === "rejected");
    assert.equal(history.length, 2);
    assert.equal(originalReject?.toStatus, "rejected");
  });
});

test("client_request_id makes selection events idempotent", () => {
  withDb((db) => {
    const input = {
      campaignId,
      itemId: "item-kol-karenxcheng",
      actorId: "client-reviewer-1",
      actorRole: "client" as const,
      toStatus: "approved" as const,
      decision: "approved" as const,
      reasonTags: [],
      note: "",
      clientRequestId: "approve-karen-once"
    };

    const first = createSelectionEvent(db, input);
    const second = createSelectionEvent(db, input);
    const history = getSelectionHistory(db, campaignId, "item-kol-karenxcheng");

    assert.equal(first.event.id, second.event.id);
    assert.equal(history.length, 1);
  });
});

test("root audience client actions are append-only and idempotent", () => {
  withDb((db) => {
    const first = createClientActionEvent(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      surface: "root_audience",
      entityType: "root_person",
      entityId: "@sama",
      actionType: "decision_set",
      fromValue: "pending",
      toValue: "approved",
      reasonTags: [],
      note: "",
      metadata: { personName: "Sam Altman", groupName: "行业超级大佬", round: 1 },
      clientRequestId: "root-sam-approve-once"
    });
    const second = createClientActionEvent(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      surface: "root_audience",
      entityType: "root_person",
      entityId: "@sama",
      actionType: "decision_set",
      fromValue: "pending",
      toValue: "approved",
      reasonTags: [],
      note: "",
      metadata: { personName: "Sam Altman", groupName: "行业超级大佬", round: 1 },
      clientRequestId: "root-sam-approve-once"
    });

    createClientActionEvent(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      surface: "root_audience",
      entityType: "root_person",
      entityId: "@sama",
      actionType: "decision_undo",
      fromValue: "approved",
      toValue: "pending",
      reasonTags: [],
      note: "",
      metadata: { personName: "Sam Altman", groupName: "行业超级大佬", round: 1 },
      clientRequestId: "root-sam-undo"
    });

    assert.equal(first.id, second.id);

    const events = getClientActionEvents(db, campaignId, { surface: "root_audience", entityId: "@sama" });
    assert.equal(events.length, 2);
    assert.equal(events[0].actionType, "decision_undo");
    assert.equal(events[1].actionType, "decision_set");
    assert.equal(events[1].metadata.personName, "Sam Altman");
  });
});

test("root audience snapshot can create a versioned KOL generation run", () => {
  withDb((db) => {
    const snapshot = createRootAudienceSnapshot(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      round: 1,
      snapshot: {
        round: 1,
        decisions: {
          "@sama": { status: "approved" },
          "@pmarca": { status: "approved" },
          "@elonmusk": { status: "rejected", reason: "本轮不优先" }
        },
        ruleComments: {},
        summary: { total: 3, approved: 2, rejected: 1, question: 0, pending: 0 },
        groups: [
          {
            name: "行业超级大佬",
            people: [
              { name: "Elon Musk", handle: "@elonmusk", role: "xAI / Tesla / X", status: "rejected" },
              { name: "Sam Altman", handle: "@sama", role: "OpenAI CEO", status: "approved" },
              { name: "Marc Andreessen", handle: "@pmarca", role: "a16z co-founder", status: "approved" }
            ]
          }
        ]
      },
      clientRequestId: "snapshot-round-1"
    });
    const sameSnapshot = createRootAudienceSnapshot(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      round: 1,
      snapshot: {
        round: 1,
        decisions: {
          "@sama": { status: "approved" }
        }
      },
      clientRequestId: "snapshot-round-1"
    });

    assert.equal(snapshot.id, sameSnapshot.id);
    assert.equal(getLatestRootAudienceSnapshot(db, campaignId)?.id, snapshot.id);

    const run = createKolGenerationRun(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      sourceSnapshotId: snapshot.id,
      clientRequestId: "generation-round-1"
    });
    const sameRun = createKolGenerationRun(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      sourceSnapshotId: snapshot.id,
      clientRequestId: "generation-round-1"
    });

    assert.equal(run.id, sameRun.id);
    assert.equal(run.status, "succeeded");
    assert.equal(run.itemCount, 106);
    assert.equal(run.items?.length, 106);
    assert.equal(run.items?.some((item) => item.campaignKolItemId === "item-kol-jonerlichman"), false);
    assert.equal(getGenerationRuns(db, campaignId).length, 1);

    const board = getCampaignBoard(db, campaignId, "client");
    assert.equal(board.activeGenerationRun?.id, run.id);
    assert.equal(board.items.length, 106);
    assert.equal(board.items.some((item) => item.id === "item-kol-jonerlichman"), false);
    assert.equal(board.activeGenerationRun?.metadata.generator, "seed_pool_root_filter_v1");
    assert.equal(board.items[0].metadata.generation && typeof board.items[0].metadata.generation === "object", true);

    const json = exportSelection(db, campaignId, "json") as Exclude<ReturnType<typeof exportSelection>, string>;
    assert.equal(json.rootAudienceSnapshots.length, 1);
    assert.equal(json.generationRuns.length, 1);
    assert.equal(json.activeGenerationRun?.id, run.id);
  });
});

test("rejected root audience removes KOLs that only depend on that root graph edge", () => {
  withDb((db) => {
    insertRootKolEdge(db, {
      rootHandle: "@pmarca",
      rootName: "Marc Andreessen",
      rootGroup: "美国 VC 中高层",
      itemId: "item-kol-startupideaspod",
      kolId: "kol-startupideaspod",
      kolHandle: "@startupideaspod"
    });
    insertRootKolEdge(db, {
      rootHandle: "@pmarca",
      rootName: "Marc Andreessen",
      rootGroup: "美国 VC 中高层",
      itemId: "item-kol-rohanpaul-ai",
      kolId: "kol-rohanpaul-ai",
      kolHandle: "@rohanpaul_ai"
    });
    insertRootKolEdge(db, {
      rootHandle: "@sama",
      rootName: "Sam Altman",
      rootGroup: "行业超级大佬",
      itemId: "item-kol-rohanpaul-ai",
      kolId: "kol-rohanpaul-ai",
      kolHandle: "@rohanpaul_ai"
    });

    const config = getProjectConfig("ilands-aaa-signal-map");
    const snapshot = createRootAudienceSnapshot(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      round: 2,
      snapshot: {
        round: 2,
        decisions: {
          "@pmarca": { status: "rejected", reason: "本轮不优先" },
          "@sama": { status: "approved" }
        },
        groups: config.ui.roots?.groups ?? []
      },
      clientRequestId: "snapshot-root-graph-reject"
    });

    const run = createKolGenerationRun(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      sourceSnapshotId: snapshot.id,
      clientRequestId: "generation-root-graph-reject"
    });
    const runItemIds = new Set(run.items?.map((item) => item.campaignKolItemId) ?? []);

    assert.equal(runItemIds.has("item-kol-startupideaspod"), false);
    assert.equal(runItemIds.has("item-kol-rohanpaul-ai"), true);
  });
});

test("generation run can persist newly discovered KOL candidates", () => {
  withDb((db) => {
    const snapshot = createRootAudienceSnapshot(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      round: 1,
      snapshot: {
        round: 1,
        decisions: {
          "@sama": { status: "approved" }
        },
        summary: { total: 1, approved: 1, rejected: 0, question: 0, pending: 0 },
        groups: [
          {
            name: "行业超级大佬",
            people: [{ name: "Sam Altman", handle: "@sama", status: "approved" }]
          }
        ]
      },
      clientRequestId: "snapshot-discovery-round-1"
    });

    const run = createKolGenerationRun(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      sourceSnapshotId: snapshot.id,
      clientRequestId: "generation-discovery-round-1",
      itemLimit: 8,
      discoveredCandidates: [
        {
          handle: "@new_ai_builder",
          name: "New AI Builder",
          bio: "Building AI agents, developer tools, and product workflows.",
          followers: 88000,
          sourceRootHandle: "1 selected roots / 2 universe roots",
          source: "twitter241_kol_universe_filter",
          scoreHint: 118,
          metadata: { selectedFollowedByCount: 1, selectedFollowedByHandles: ["@sama"], universeFollowedByCount: 2 }
        }
      ],
      discoveryMetadata: {
        provider: "twitter241",
        strategy: "kol_universe_then_root_filter_v1",
        status: "succeeded",
        candidateCount: 1
      }
    });

    const board = getCampaignBoard(db, campaignId, "client");
    assert.equal(run.itemCount, 8);
    assert.equal(board.items.length, 8);
    assert.equal(board.summary.total, 8);
    assert.equal(board.items.some((item) => item.kol.handle === "new_ai_builder"), true);
    assert.equal(board.activeGenerationRun?.metadata.generator, "kol_universe_then_root_filter_v1");

    const discovered = board.items.find((item) => item.kol.handle === "new_ai_builder");
    assert.equal(discovered?.metadata.discovery && typeof discovered.metadata.discovery === "object", true);
    assert.equal(discovered?.kol.profileUrl, "https://x.com/new_ai_builder");
  });
});

test("exports grouped JSON and CSV decision packages", () => {
  withDb((db) => {
    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-mlstreettalk",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "approved",
      decision: "approved",
      reasonTags: ["priority_fit"],
      note: "适合第一波严肃讨论。",
      clientRequestId: "export-approve-mlst"
    });
    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-linusekenstam",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "rejected",
      decision: "rejected",
      reasonTags: ["too_generic"],
      note: "先不进入第一波。",
      clientRequestId: "export-reject-linus"
    });
    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-binarybits",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "question",
      decision: "question",
      reasonTags: ["need_contact_confirmation"],
      note: "请先确认是否接受 sponsor 或只能走 earned media。",
      clientRequestId: "export-question-binarybits"
    });
    createClientActionEvent(db, {
      campaignId,
      actorId: "client-reviewer-1",
      actorRole: "client",
      surface: "root_audience",
      entityType: "root_group",
      entityId: "行业超级大佬",
      actionType: "rules_expand",
      fromValue: "closed",
      toValue: "open",
      metadata: { round: 1 },
      clientRequestId: "export-root-action"
    });

    const json = exportSelection(db, campaignId, "json") as Exclude<ReturnType<typeof exportSelection>, string>;
    assert.equal(json.approved.length, 1);
    assert.equal(json.rejected.length, 1);
    assert.equal(json.question.length, 1);
    assert.equal(json.rootAudienceLog.length, 1);
    assert.equal(json.rootAudienceLog[0].actionType, "rules_expand");

    const csv = exportSelection(db, campaignId, "csv") as string;
    assert.equal(typeof csv, "string");
    assert.match(csv, /section,status,name,handle/);
    assert.match(csv, /rejected/);
  });
});

test("client users cannot lock the selection version", () => {
  withDb((db) => {
    assert.throws(
      () => lockSelection(db, campaignId, "client-reviewer-1", "client"),
      (error) => error instanceof ApiError && error.status === 403
    );
  });
});
