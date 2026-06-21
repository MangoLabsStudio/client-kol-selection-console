export const selectionStatuses = ["pending", "approved", "rejected", "question", "hold"] as const;
export type SelectionStatus = (typeof selectionStatuses)[number];

export const actorRoles = ["client", "agency", "admin", "system"] as const;
export type ActorRole = (typeof actorRoles)[number];

export type CampaignRow = {
  id: string;
  client_id: string;
  name: string;
  review_round: string;
  objective: string;
  locked_at: string | null;
  last_updated_at: string;
  created_at: string;
};

export type ClientRow = {
  id: string;
  name: string;
  tier: string;
};

export type Summary = Record<SelectionStatus | "total", number>;

export type CreateSelectionEventInput = {
  campaignId: string;
  itemId: string;
  actorId: string;
  actorRole: ActorRole;
  toStatus: SelectionStatus;
  decision: SelectionStatus | "approve" | "reject" | "undo";
  reasonTags?: string[];
  note?: string;
  visibility?: "client_visible" | "agency_only";
  clientRequestId?: string;
  metadata?: Record<string, unknown>;
};

export type ApiErrorPayload = {
  error: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}
