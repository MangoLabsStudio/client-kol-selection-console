import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../server/db.js";
import { getClientAppConfig, getProjectConfig } from "../server/projectConfig.js";
import { seedDemoData } from "../server/seed.js";
import { createSelectionEvent, exportSelection, getCampaignBoard, getSelectionHistory, lockSelection } from "../server/selectionService.js";
import { ApiError } from "../server/types.js";

const campaignId = "campaign-frontier-ai-launch";

function withDb(run: (db: DatabaseSync) => void) {
  const db = createDatabase({ dbPath: ":memory:" });
  try {
    run(db);
  } finally {
    db.close();
  }
}

test("loads the seeded campaign board with current-state summary", () => {
  withDb((db) => {
    const board = getCampaignBoard(db, campaignId, "client");

    assert.equal(board.campaign.clientName, "iLands");
    assert.equal(board.campaign.name, "iLands AI KOL 候选评审");
    assert.equal(board.items.length, 10);
    assert.deepEqual(board.summary, {
      total: 10,
      pending: 6,
      approved: 1,
      rejected: 1,
      question: 1,
      hold: 1
    });
  });
});

test("loads project config for project-specific UI and seed data", () => {
  const config = getProjectConfig("ilands-aaa-signal-map");
  const appConfig = getClientAppConfig("ilands-aaa-signal-map");

  assert.equal(config.client.name, "iLands");
  assert.equal(config.campaign.id, campaignId);
  assert.equal(config.ui.brand.name, "iLands KOL 候选评审");
  assert.equal(config.seed.candidates.length, 10);
  assert.equal(appConfig.campaignId, campaignId);
  assert.equal(appConfig.availableProjects.some((project) => project.projectId === "ilands-aaa-signal-map"), true);
});

test("reject requires at least one reason tag", () => {
  withDb((db) => {
    assert.throws(
      () =>
        createSelectionEvent(db, {
          campaignId,
          itemId: "item-kol-mira-chen",
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

test("seed sync refreshes demo notes without overwriting real review decisions", () => {
  withDb((db) => {
    db
      .prepare("UPDATE kol_selection_current_state SET current_note = ? WHERE campaign_kol_item_id = ?")
      .run("Old English seed note.", "item-kol-lena-vos");
    db
      .prepare("UPDATE kol_selection_events SET note = ? WHERE campaign_kol_item_id = ? AND id LIKE 'event-seed%'")
      .run("Old English seed event.", "item-kol-lena-vos");

    createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-mira-chen",
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
    const lena = board.items.find((item) => item.id === "item-kol-lena-vos");
    const mira = board.items.find((item) => item.id === "item-kol-mira-chen");

    assert.equal(lena?.currentState.currentNote, "受众匹配度高，技术表达可信。");
    assert.equal(mira?.currentState.currentNote, "客户后续评审备注，不应被 seed 覆盖。");
  });
});

test("reject writes event log, current state, and summary", () => {
  withDb((db) => {
    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-mira-chen",
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
    assert.equal(result.summary.pending, 5);
    assert.equal(result.summary.rejected, 2);

    const history = getSelectionHistory(db, campaignId, "item-kol-mira-chen");
    assert.equal(history.length, 1);
    assert.equal(history[0].eventType, "decision_created");
  });
});

test("question creates an open follow-up task", () => {
  withDb((db) => {
    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-theo-park",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "question",
      decision: "question",
      reasonTags: ["need_price", "need_case_sample"],
      note: "Please confirm price and a relevant founder-interview sample.",
      clientRequestId: "question-theo"
    });

    assert.equal(result.currentState.currentStatus, "question");
    assert.equal(result.summary.question, 2);

    const followup = db
      .prepare("SELECT * FROM kol_selection_followups WHERE campaign_kol_item_id = ? AND created_from_event_id = ?")
      .get("item-kol-theo-park", result.event.id);
    assert.equal(followup?.status, "open");
    assert.equal(followup?.task_type, "need_price");
  });
});

test("changing a rejected KOL to approved appends a new event", () => {
  withDb((db) => {
    const result = createSelectionEvent(db, {
      campaignId,
      itemId: "item-kol-jules-gray",
      actorId: "client-reviewer-1",
      actorRole: "client",
      toStatus: "approved",
      decision: "approved",
      reasonTags: ["priority_fit"],
      note: "Use only if broad awareness budget is approved.",
      clientRequestId: "change-jules"
    });

    assert.equal(result.currentState.currentStatus, "approved");
    assert.equal(result.event.eventType, "decision_changed");
    assert.equal(result.event.fromStatus, "rejected");

    const history = getSelectionHistory(db, campaignId, "item-kol-jules-gray");
    const originalReject = history.find((event) => event.eventType === "decision_created" && event.toStatus === "rejected");
    assert.equal(history.length, 2);
    assert.equal(originalReject?.toStatus, "rejected");
  });
});

test("client_request_id makes selection events idempotent", () => {
  withDb((db) => {
    const input = {
      campaignId,
      itemId: "item-kol-hana-lee",
      actorId: "client-reviewer-1",
      actorRole: "client" as const,
      toStatus: "approved" as const,
      decision: "approved" as const,
      reasonTags: [],
      note: "",
      clientRequestId: "approve-hana-once"
    };

    const first = createSelectionEvent(db, input);
    const second = createSelectionEvent(db, input);
    const history = getSelectionHistory(db, campaignId, "item-kol-hana-lee");

    assert.equal(first.event.id, second.event.id);
    assert.equal(history.length, 1);
  });
});

test("exports grouped JSON and CSV decision packages", () => {
  withDb((db) => {
    const json = exportSelection(db, campaignId, "json") as Exclude<ReturnType<typeof exportSelection>, string>;
    assert.equal(json.approved.length, 1);
    assert.equal(json.rejected.length, 1);
    assert.equal(json.question.length, 1);

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
