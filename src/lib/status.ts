import type { SelectionStatus } from "./types";

export const statusLabels: Record<SelectionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  question: "Need info",
  hold: "Hold"
};

export const statusTone: Record<SelectionStatus, string> = {
  pending: "neutral",
  approved: "success",
  rejected: "danger",
  question: "info",
  hold: "warning"
};

export const rejectReasons = [
  ["audience_mismatch", "Audience mismatch"],
  ["brand_fit_mismatch", "Brand fit mismatch"],
  ["content_style_mismatch", "Content style mismatch"],
  ["too_expensive", "Too expensive"],
  ["weak_creator_quality", "Creator quality"],
  ["weak_engagement_quality", "Engagement quality"],
  ["wrong_region_or_language", "Region / language"],
  ["platform_mismatch", "Platform mismatch"],
  ["not_relevant_to_campaign", "Not relevant"],
  ["too_generic", "Too generic"],
  ["too_niche", "Too niche"],
  ["brand_safety_risk", "Brand safety"],
  ["competitor_conflict", "Competitor conflict"],
  ["duplicated_with_other_kol", "Duplicated"],
  ["not_a_real_creator", "Not a creator"],
  ["commercial_path_unclear", "Commercial path unclear"],
  ["client_internal_reason", "Internal reason"],
  ["other", "Other"]
] as const;

export const questionReasons = [
  ["need_price", "Need price"],
  ["need_case_sample", "Need case sample"],
  ["need_audience_data", "Need audience data"],
  ["need_recent_performance", "Recent performance"],
  ["need_contact_confirmation", "Contact confirmation"],
  ["need_content_angle", "Content angle"],
  ["need_brand_safety_check", "Brand safety check"],
  ["need_internal_discussion", "Internal discussion"],
  ["other", "Other"]
] as const;

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatTime(value: string | null) {
  if (!value) return "Not updated";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
