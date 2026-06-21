import type { DatabaseSync } from "node:sqlite";
import { getAllProjectConfigs, getProjectConfig, type ProjectConfig, type SeedKolConfig } from "./projectConfig.js";

export const seedCampaignId = getProjectConfig().campaign.id;

export function seedDemoData(db: DatabaseSync) {
  for (const config of getAllProjectConfigs()) {
    seedProjectData(db, config);
  }
}

function seedProjectData(db: DatabaseSync, config: ProjectConfig) {
  const timestamp = config.seed.now ?? new Date().toISOString();
  const existingItems = db.prepare("SELECT COUNT(*) AS count FROM campaign_kol_items WHERE campaign_id = ?").get(config.campaign.id);
  const hasCampaignItems = Number(existingItems?.count ?? 0) > 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    upsertClient(db, config, timestamp);
    upsertCampaign(db, config, timestamp);

    if (hasCampaignItems) {
      db.exec("COMMIT");
      return;
    }

    const insertProfile = db.prepare(
      `INSERT INTO kol_profiles (
        id, name, handle, platform, profile_url, avatar_url, bio, followers, region, language,
        content_category, email, contact_url, audience_summary, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        handle = excluded.handle,
        platform = excluded.platform,
        profile_url = excluded.profile_url,
        avatar_url = excluded.avatar_url,
        bio = excluded.bio,
        followers = excluded.followers,
        region = excluded.region,
        language = excluded.language,
        content_category = excluded.content_category,
        contact_url = excluded.contact_url,
        audience_summary = excluded.audience_summary,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at`
    );
    const insertItem = db.prepare(
      `INSERT INTO campaign_kol_items (
        id, client_id, campaign_id, kol_id, display_order, status_current, client_facing_note,
        agency_internal_note, why_included, recommended_angle, estimated_price, contact_status,
        risk_tags, metadata, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertEvent = db.prepare(
      `INSERT INTO kol_selection_events (
        id, client_id, campaign_id, campaign_kol_item_id, kol_id, actor_id, actor_role, event_type,
        from_status, to_status, decision, reason_tags, note, visibility, client_request_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const upsertState = db.prepare(
      `INSERT INTO kol_selection_current_state (
        id, client_id, campaign_id, campaign_kol_item_id, kol_id, current_status, current_decision,
        current_reason_tags, current_note, last_event_id, last_actor_id, last_actor_role, last_updated_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertFollowup = db.prepare(
      `INSERT INTO kol_selection_followups (
        id, client_id, campaign_id, campaign_kol_item_id, kol_id, task_type, question_text,
        status, assigned_to, answer_text, created_from_event_id, resolved_by, resolved_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    config.seed.candidates.forEach((kol, index) => {
      const itemId = getItemId(config, kol);
      const status = kol.initial?.status ?? "pending";

      insertProfile.run(
        kol.id,
        kol.name,
        kol.handle,
        kol.platform,
        kol.profileUrl,
        kol.avatarUrl,
        kol.bio,
        kol.followers,
        kol.region,
        kol.language,
        kol.contentCategory,
        null,
        kol.profileUrl,
        kol.audienceSummary,
        JSON.stringify(kol.metadata ?? {}),
        timestamp,
        timestamp
      );

      insertItem.run(
        itemId,
        config.client.id,
        config.campaign.id,
        kol.id,
        index + 1,
        status,
        kol.clientFacingNote,
        kol.agencyInternalNote,
        kol.whyIncluded,
        kol.recommendedAngle,
        kol.estimatedPrice,
        kol.contactStatus,
        JSON.stringify(kol.riskTags ?? []),
        JSON.stringify({ importedFrom: `${config.projectId}_config`, rankHint: index + 1 }),
        "agency-demo",
        timestamp,
        timestamp
      );

      if (kol.initial) {
        const eventId = `event-seed-${config.projectId}-${kol.id}`;
        insertEvent.run(
          eventId,
          config.client.id,
          config.campaign.id,
          itemId,
          kol.id,
          "client-reviewer-1",
          kol.initial.actorRole ?? "client",
          "decision_created",
          "pending",
          kol.initial.status,
          seedDecision(kol.initial.status),
          JSON.stringify(kol.initial.reasonTags),
          kol.initial.note,
          "client_visible",
          `seed-${config.projectId}-${kol.id}`,
          JSON.stringify({ seeded: true, projectId: config.projectId }),
          timestamp
        );
        upsertState.run(
          `state-${config.projectId}-${kol.id}`,
          config.client.id,
          config.campaign.id,
          itemId,
          kol.id,
          kol.initial.status,
          seedDecision(kol.initial.status),
          JSON.stringify(kol.initial.reasonTags),
          kol.initial.note,
          eventId,
          "client-reviewer-1",
          kol.initial.actorRole ?? "client",
          timestamp,
          timestamp,
          timestamp
        );

        if (kol.initial.status === "question") {
          insertFollowup.run(
            `followup-seed-${config.projectId}-${kol.id}`,
            config.client.id,
            config.campaign.id,
            itemId,
            kol.id,
            kol.initial.reasonTags[0] ?? "other",
            kol.initial.note,
            "open",
            "agency-ops",
            null,
            eventId,
            null,
            null,
            timestamp,
            timestamp
          );
        }
      }
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function upsertClient(db: DatabaseSync, config: ProjectConfig, timestamp: string) {
  db.prepare(
    `INSERT INTO clients (id, name, tier, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tier = excluded.tier`
  ).run(config.client.id, config.client.name, config.client.tier, timestamp);
}

function upsertCampaign(db: DatabaseSync, config: ProjectConfig, timestamp: string) {
  db.prepare(
    `INSERT INTO campaigns (id, client_id, name, review_round, objective, locked_at, last_updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_id = excluded.client_id,
      name = excluded.name,
      review_round = excluded.review_round,
      objective = excluded.objective`
  ).run(config.campaign.id, config.client.id, config.campaign.name, config.campaign.reviewRound, config.campaign.objective, null, timestamp, timestamp);
}

function getItemId(config: ProjectConfig, kol: SeedKolConfig) {
  return kol.itemId ?? `item-${config.projectId}-${kol.id}`;
}

function seedDecision(status: "approved" | "rejected" | "question" | "hold") {
  if (status === "approved") return "approve";
  if (status === "rejected") return "reject";
  return status;
}
