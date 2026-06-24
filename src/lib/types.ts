export type SelectionStatus = "pending" | "approved" | "rejected" | "question" | "hold";
export type ActorRole = "client" | "agency" | "admin" | "system";

export type Summary = Record<SelectionStatus | "total", number>;

export type Campaign = {
  id: string;
  clientId: string;
  clientName: string;
  clientTier: string;
  name: string;
  reviewRound: string;
  objective: string;
  lockedAt: string | null;
  lastUpdatedAt: string;
  createdAt: string;
};

export type KolProfile = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  profileUrl: string;
  avatarUrl: string;
  bio: string;
  followers: number;
  region: string;
  language: string;
  contentCategory: string;
  audienceSummary: string;
  metadata: {
    previousExamples?: string[];
    audienceFit?: number;
    [key: string]: unknown;
  };
};

export type CurrentState = {
  id: string | null;
  currentStatus: SelectionStatus;
  currentDecision: string;
  currentReasonTags: string[];
  currentNote: string;
  lastEventId: string | null;
  lastActorId: string | null;
  lastActorRole: string | null;
  lastUpdatedAt: string;
};

export type CampaignKolItem = {
  id: string;
  clientId: string;
  campaignId: string;
  displayOrder: number;
  clientFacingNote: string;
  agencyInternalNote: string | null;
  whyIncluded: string;
  recommendedAngle: string;
  estimatedPrice: string;
  contactStatus: string;
  riskTags: string[];
  metadata: Record<string, unknown>;
  currentState: CurrentState;
  kol: KolProfile;
};

export type BoardResponse = {
  campaign: Campaign;
  summary: Summary;
  items: CampaignKolItem[];
};

export type SelectionEvent = {
  id: string;
  clientId: string;
  campaignId: string;
  campaignKolItemId: string | null;
  kolId: string | null;
  actorId: string;
  actorRole: ActorRole;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  decision: string | null;
  reasonTags: string[];
  note: string;
  visibility: string;
  clientRequestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DecisionHistoryEntry = SelectionEvent & {
  kolName: string | null;
  kolHandle: string | null;
  kolProfileUrl: string | null;
  kolAvatarUrl: string | null;
  currentStatus: SelectionStatus;
};

export type DecisionHistoryResponse = {
  generatedAt: string;
  approved: DecisionHistoryEntry[];
  rejected: DecisionHistoryEntry[];
};

export type ClientActionEvent = {
  id: string;
  clientId: string;
  campaignId: string;
  surface: string;
  entityType: string;
  entityId: string;
  actionType: string;
  actorId: string;
  actorRole: ActorRole;
  fromValue: string | null;
  toValue: string | null;
  reasonTags: string[];
  note: string;
  metadata: Record<string, unknown>;
  clientRequestId: string | null;
  createdAt: string;
};

export type Filters = {
  status: SelectionStatus | "all";
  platform: string;
  category: string;
  language: string;
  region: string;
  followers: string;
  contactStatus: string;
  riskTag: string;
  query: string;
};

export type DecisionInput = {
  item: CampaignKolItem;
  toStatus: SelectionStatus;
  reasonTags?: string[];
  note?: string;
};

export type ProjectConfigSummary = {
  projectId: string;
  templateId?: string;
  clientName: string;
  campaignName: string;
};

export type AppConfig = {
  projectId: string;
  templateId?: string;
  clientName: string;
  campaignId: string;
  campaignName: string;
  ui: ProjectUiConfig;
  availableProjects: ProjectConfigSummary[];
};

export type ProjectUiConfig = {
  brand: {
    mark: string;
    name: string;
    subtitle: string;
  };
  navigation: Array<{
    label: string;
    target: string;
    index: string;
  }>;
  sideNote: string;
  hero: {
    eyebrow: string;
    title: string;
    lede: string;
    metrics?: Array<{
      value: string;
      label: string;
    }>;
    metricLabels: {
      total: string;
      approved: string;
      rejected: string;
      question: string;
    };
  };
  pool: {
    eyebrow: string;
    title: string;
    description: string;
    allCandidatesLabel: string;
    pendingDecisionLabel: string;
    reviewedLabel: string;
    emptyTitle: string;
    emptyAction: string;
  };
  learning: {
    storageKey: string;
    eyebrow: string;
    title: string;
    description: string;
    systemTitle: string;
    systemDescription: string;
    exportProject: string;
    exportRound: string;
    sections: LearningRuleSectionConfig[];
  };
  rules: {
    title: string;
    description: string;
    statLabel: string;
    sections: RuleSectionConfig[];
  };
  roots?: RootAudienceConfig;
  method?: MethodConfig;
  signalLogic?: SignalLogicConfig;
  dataNote?: string;
};

export type LearningRuleSectionConfig = {
  id: string;
  title: string;
  subtitle: string;
  open?: boolean;
  defaultRules: string[];
};

export type RuleSectionConfig = {
  title: string;
  subtitle: string;
  open?: boolean;
  rules: string[];
};

export type RootAudienceConfig = {
  storageKey: string;
  eyebrow: string;
  title: string;
  description: string;
  roundLabel: string;
  rerunButton: string;
  rollbackButton: string;
  lockedCopy: string;
  groups: RootAudienceGroupConfig[];
};

export type RootAudienceGroupConfig = {
  index: string;
  name: string;
  count: number;
  note: string;
  use: string;
  goal: string;
  open?: boolean;
  rules: RuleSectionConfig[];
  people: RootPersonConfig[];
};

export type RootPersonConfig = {
  name: string;
  handle: string;
  role: string;
  avatarUrl?: string;
  why: string;
  behavior: string;
  evidence: string;
};

export type MethodConfig = {
  eyebrow: string;
  title: string;
  description: string;
  axes: MethodAxisConfig[];
  routes: MethodRouteConfig[];
};

export type MethodAxisConfig = {
  title: string;
  source: string;
  take: string;
  lead: string;
  stats: Array<[string, string]>;
  note: string;
};

export type MethodRouteConfig = {
  index: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
};

export type SignalLogicConfig = {
  eyebrow: string;
  title: string;
  description: string;
  matrix: Array<{
    title: string;
    description: string;
    tone?: "good" | "anchor" | "neutral";
  }>;
  tiers: Array<{
    level: string;
    title: string;
    description: string;
  }>;
};
