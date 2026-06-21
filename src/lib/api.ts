import type { ActorRole, AppConfig, BoardResponse, SelectionEvent, SelectionStatus } from "./types";

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

export function getHistory(campaignId: string, itemId: string) {
  return request<{ events: SelectionEvent[] }>(`/api/campaigns/${campaignId}/kol-selection/${itemId}/events`);
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
