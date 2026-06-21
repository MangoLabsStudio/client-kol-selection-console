import type { SelectionStatus } from "./types";

export const statusLabels: Record<SelectionStatus, string> = {
  pending: "待评审",
  approved: "已通过",
  rejected: "已排除",
  question: "待补充",
  hold: "暂缓"
};

export const statusTone: Record<SelectionStatus, string> = {
  pending: "neutral",
  approved: "success",
  rejected: "danger",
  question: "info",
  hold: "warning"
};

export const rejectReasons = [
  ["audience_mismatch", "受众不匹配"],
  ["brand_fit_mismatch", "品牌适配度不足"],
  ["content_style_mismatch", "内容风格不匹配"],
  ["too_expensive", "预算不匹配"],
  ["weak_creator_quality", "账号质量不足"],
  ["weak_engagement_quality", "互动质量不足"],
  ["wrong_region_or_language", "地区或语言不匹配"],
  ["platform_mismatch", "平台不匹配"],
  ["not_relevant_to_campaign", "与本轮目标相关性不足"],
  ["too_generic", "内容过泛"],
  ["too_niche", "覆盖面过窄"],
  ["brand_safety_risk", "品牌安全风险"],
  ["competitor_conflict", "竞品或排他冲突"],
  ["duplicated_with_other_kol", "与其他账号重复"],
  ["not_a_real_creator", "非真实创作者账号"],
  ["commercial_path_unclear", "商业合作路径不清晰"],
  ["client_internal_reason", "客户内部原因"],
  ["other", "其他原因"]
] as const;

export const questionReasons = [
  ["need_price", "确认报价"],
  ["need_case_sample", "补充过往案例"],
  ["need_audience_data", "补充受众数据"],
  ["need_recent_performance", "补充近期表现"],
  ["need_contact_confirmation", "确认联系方式"],
  ["need_content_angle", "明确内容角度"],
  ["need_brand_safety_check", "确认品牌安全"],
  ["need_internal_discussion", "待内部讨论"],
  ["other", "其他问题"]
] as const;

const riskTagLabels: Record<string, string> = {
  broad_audience: "受众过宽",
  competitor_conflict: "需确认竞品冲突",
  demo_dependency: "依赖产品演示",
  engagement_quality_check: "需核查互动质量",
  less_technical: "技术深度偏弱",
  limited_inventory: "档期有限",
  long_form: "长内容形式",
  long_lead_time: "交付周期较长",
  lower_immediacy: "短期转化较弱",
  niche_audience: "受众较窄",
  price_sensitive: "报价敏感",
  smaller_reach: "覆盖规模较小",
  technical_depth_required: "需技术材料支撑"
};

const contactStatusLabels: Record<string, string> = {
  "direct contact": "可直接联系",
  "manager contacted": "已联系团队",
  "needs conflict check": "需确认排他",
  "not contacted": "尚未联系",
  "warm intro available": "有可用引荐"
};

const categoryLabels: Record<string, string> = {
  "AI infrastructure": "AI 基础设施",
  "AI research": "AI 研究传播",
  "AI tooling": "AI 工具评测",
  "Developer education": "开发者教育",
  "Founder interviews": "创始人访谈",
  "Founder strategy": "创始人/商业叙事",
  Operations: "运营与流程",
  "Product design": "产品设计",
  "Startup growth": "创业增长",
  "Venture and markets": "投资与市场叙事"
};

export function formatReasonTag(value: string) {
  return reasonLabelMap[value] ?? value.replaceAll("_", " ");
}

export function formatRiskTag(value: string) {
  return riskTagLabels[value] ?? value.replaceAll("_", " ");
}

export function formatContactStatus(value: string) {
  return contactStatusLabels[value] ?? value;
}

export function formatContentCategory(value: string) {
  return categoryLabels[value] ?? value;
}

export function formatCompactNumber(value: number) {
  if (value >= 100000000) return `${trimDecimal(value / 100000000)} 亿`;
  if (value >= 10000) return `${trimDecimal(value / 10000)} 万`;
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatTime(value: string | null) {
  if (!value) return "未更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const reasonLabelMap: Record<string, string> = Object.fromEntries([...rejectReasons, ...questionReasons]);

function trimDecimal(value: number) {
  return value.toFixed(1).replace(/\\.0$/, "");
}
