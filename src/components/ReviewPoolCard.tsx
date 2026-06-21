import { motion } from "framer-motion";
import { BadgeCheck, CircleHelp, ExternalLink, History, Undo2, XCircle } from "lucide-react";
import type { CampaignKolItem, SelectionStatus } from "../lib/types";
import { formatCompactNumber, formatContactStatus, formatContentCategory, formatRiskTag } from "../lib/status";

type ReviewPoolCardProps = {
  item: CampaignKolItem;
  loadingStatus: SelectionStatus | "undo" | null;
  onApprove: (item: CampaignKolItem) => void;
  onUndo: (item: CampaignKolItem) => void;
  onReject: (item: CampaignKolItem) => void;
  onQuestion: (item: CampaignKolItem) => void;
  onHistory: (item: CampaignKolItem) => void;
};

export function ReviewPoolCard({ item, loadingStatus, onApprove, onReject, onQuestion, onUndo, onHistory }: ReviewPoolCardProps) {
  const status = item.currentState.currentStatus;
  const reviewStatus = status === "approved" ? "approve" : status === "rejected" ? "reject" : status === "question" ? "question" : status === "hold" ? "hold" : "";
  const audienceFit = Number(item.kol.metadata.audienceFit ?? 0);
  const tier = tierFromFit(audienceFit);
  const sourceList = Array.isArray(item.kol.metadata.previousExamples) ? item.kol.metadata.previousExamples.map(String) : [];
  const followers = formatCompactNumber(item.kol.followers);

  return (
    <motion.article
      layout
      className={`expanded-kol-card ${tier.className}`}
      data-review-status={reviewStatus || undefined}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <div className="expanded-kol-top">
        <div className="expanded-kol-identity">
          <a className="expanded-kol-avatar" href={item.kol.profileUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.kol.name} 主页`}>
            <img src={item.kol.avatarUrl} alt="" loading="lazy" />
          </a>
          <div className="expanded-kol-name">
            <a href={item.kol.profileUrl} target="_blank" rel="noreferrer">
              {item.kol.name}
              <ExternalLink size={12} />
            </a>
            <span>
              {item.kol.handle} · {followers}
            </span>
          </div>
        </div>
        <span className="expanded-score">{audienceFit || "待评"}</span>
      </div>

      <div className="expanded-tags">
        <span>{tier.label}</span>
        <span>{item.kol.platform}</span>
        <span>{formatContentCategory(item.kol.contentCategory)}</span>
        <span>{formatContactStatus(item.contactStatus)}</span>
        {item.riskTags.slice(0, 2).map((risk) => (
          <span className={risk === "none" ? "" : "warn"} key={risk}>
            {formatRiskTag(risk)}
          </span>
        ))}
      </div>

      <p>{item.whyIncluded}</p>
      <div className="expanded-next">
        <b>建议动作：</b>
        {item.recommendedAngle}
      </div>

      <details>
        <summary>判断依据</summary>
        <dl>
          <div>
            <dt>目标受众</dt>
            <dd>{item.kol.audienceSummary}</dd>
          </div>
          <div>
            <dt>规模与合作状态</dt>
            <dd>
              {followers}；{item.estimatedPrice || "报价待确认"}；{formatContactStatus(item.contactStatus)}
            </dd>
          </div>
          <div>
            <dt>参考内容</dt>
            <dd>{sourceList.length > 0 ? sourceList.join(" / ") : item.clientFacingNote}</dd>
          </div>
        </dl>
      </details>

      <div className="review-mini-panel" aria-label={`评审 ${item.kol.name}`}>
        <div className="review-decision-row">
          <DecisionButton
            className="approve"
            selected={status === "approved"}
            loading={loadingStatus === "approved"}
            onClick={() => onApprove(item)}
            icon={<BadgeCheck size={14} />}
            label="通过"
          />
          <DecisionButton
            className="reject"
            selected={status === "rejected"}
            loading={loadingStatus === "rejected"}
            onClick={() => onReject(item)}
            icon={<XCircle size={14} />}
            label="排除"
          />
          <DecisionButton
            className="question"
            selected={status === "question"}
            loading={loadingStatus === "question"}
            onClick={() => onQuestion(item)}
            icon={<CircleHelp size={14} />}
            label="需补充"
          />
        </div>
        <div className="review-utility-row">
          <button type="button" className="review-utility" onClick={() => onHistory(item)}>
            <History size={13} />
            记录
          </button>
          <button
            type="button"
            className="review-utility review-undo"
            onClick={() => onUndo(item)}
            disabled={status === "pending" || loadingStatus === "undo"}
            aria-label={status === "pending" ? `${item.kol.name} 暂无可撤回的评审` : `撤回 ${item.kol.name} 的评审`}
          >
            {loadingStatus === "undo" ? <span className="spinner" /> : <Undo2 size={13} />}
            撤回
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function DecisionButton({
  className,
  selected,
  loading,
  onClick,
  icon,
  label
}: {
  className: "approve" | "reject" | "question";
  selected: boolean;
  loading: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button type="button" className={`review-decision ${className} ${selected ? "is-selected" : ""}`} onClick={onClick} disabled={selected || loading}>
      {loading ? <span className="spinner" /> : icon}
      {label}
    </button>
  );
}

function tierFromFit(fit: number) {
  if (fit >= 88) return { className: "tier-a", label: "A 级｜优先推进" };
  if (fit >= 80) return { className: "tier-b", label: "B 级｜补充验证" };
  if (fit >= 70) return { className: "tier-c", label: "C 级｜备选观察" };
  return { className: "tier-d", label: "D 级｜暂不优先" };
}
