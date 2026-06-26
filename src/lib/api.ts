import type {
  ActorRole,
  AppConfig,
  BoardResponse,
  ClientActionEvent,
  DecisionHistoryResponse,
  KolGenerationRun,
  RootAudienceSnapshot,
  RootAudienceSnapshotInput,
  SelectionEvent,
  SelectionStatus
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function getAppConfig(projectId?: string | null) {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  return request<AppConfig>(`/api/app-config${query}`);
}

export function getBoardForCampaign(campaignId: string, actorRole: ActorRole) {
  return request<BoardResponse>(`/api/campaigns/${campaignId}/kol-selection?role=${actorRole}`);
}

export function getDecisionHistory(campaignId: string, actorRole: ActorRole) {
  return request<DecisionHistoryResponse>(`/api/campaigns/${campaignId}/kol-selection/decision-history?role=${actorRole}`);
}

export function submitDecision(input: {
  campaignId: string;
  itemId: string;
  actorRole: ActorRole;
  toStatus: SelectionStatus;
  reasonTags?: string[];
  note?: string;
}) {
  return request<{
    event: SelectionEvent;
    currentState: BoardResponse["items"][number]["currentState"];
    summary: BoardResponse["summary"];
  }>(`/api/campaigns/${input.campaignId}/kol-selection/${input.itemId}/events`, {
    method: "POST",
    headers: {
      "x-actor-role": input.actorRole,
      "x-actor-id": input.actorRole === "agency" ? "agency-ops" : "client-reviewer-1"
    },
    body: JSON.stringify({
      to_status: input.toStatus,
      decision: input.toStatus === "approved" ? "approve" : input.toStatus,
      reason_tags: input.reasonTags ?? [],
      note: input.note ?? "",
      client_request_id: crypto.randomUUID()
    })
  });
}

export function submitClientAction(input: {
  campaignId: string;
  actorRole: ActorRole;
  surface: string;
  entityType: string;
  entityId: string;
  actionType: string;
  fromValue?: string | null;
  toValue?: string | null;
  reasonTags?: string[];
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  return request<{ event: ClientActionEvent }>(`/api/campaigns/${input.campaignId}/client-actions`, {
    method: "POST",
    headers: {
      "x-actor-role": input.actorRole,
      "x-actor-id": input.actorRole === "agency" ? "agency-ops" : "client-reviewer-1"
    },
    body: JSON.stringify({
      surface: input.surface,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action_type: input.actionType,
      from_value: input.fromValue ?? null,
      to_value: input.toValue ?? null,
      reason_tags: input.reasonTags ?? [],
      note: input.note ?? "",
      metadata: input.metadata ?? {},
      client_request_id: crypto.randomUUID()
    })
  });
}

export async function createRootAudienceGeneration(input: {
  campaignId: string;
  actorRole: ActorRole;
  snapshot: RootAudienceSnapshotInput;
}) {
  const requestId = crypto.randomUUID();
  const snapshotResponse = await request<{ snapshot: RootAudienceSnapshot }>(`/api/campaigns/${input.campaignId}/root-audience/snapshots`, {
    method: "POST",
    headers: {
      "x-actor-role": input.actorRole,
      "x-actor-id": input.actorRole === "agency" ? "agency-ops" : "client-reviewer-1"
    },
    body: JSON.stringify({
      round: input.snapshot.round,
      snapshot: input.snapshot,
      client_request_id: `root-snapshot-${requestId}`
    })
  });

  const runResponse = await request<{ run: KolGenerationRun }>(`/api/campaigns/${input.campaignId}/kol-generation-runs`, {
    method: "POST",
    headers: {
      "x-actor-role": input.actorRole,
      "x-actor-id": input.actorRole === "agency" ? "agency-ops" : "client-reviewer-1"
    },
    body: JSON.stringify({
      source_snapshot_id: snapshotResponse.snapshot.id,
      trigger_reason: "root_audience_confirmed",
      metadata: {
        rootRound: input.snapshot.round,
        approvedRootCount: input.snapshot.summary.approved ?? 0,
        rejectedRootCount: input.snapshot.summary.rejected ?? 0,
        questionRootCount: input.snapshot.summary.question ?? 0
      },
      client_request_id: `kol-generation-${requestId}`
    })
  });

  return {
    snapshot: snapshotResponse.snapshot,
    run: runResponse.run
  };
}

export async function exportBoard(campaignId: string, projectId: string, format: "json" | "csv") {
  const response = await fetch(`/api/campaigns/${campaignId}/kol-selection/export?format=${format}`);
  if (!response.ok) throw new Error("Could not export selection");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectId}-kol-selection.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function lockBoard(campaignId: string, actorRole: ActorRole) {
  return request<BoardResponse>(`/api/campaigns/${campaignId}/kol-selection/lock`, {
    method: "POST",
    headers: {
      "x-actor-role": actorRole,
      "x-actor-id": "agency-ops"
    },
    body: JSON.stringify({})
  });
}
