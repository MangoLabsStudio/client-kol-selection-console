import { motion } from "framer-motion";
import { BadgeCheck, CircleHelp, Clock3, ExternalLink, History, RotateCcw, XCircle } from "lucide-react";
import type { CampaignKolItem, SelectionStatus } from "../lib/types";
import { formatCompactNumber, statusLabels } from "../lib/status";

type ReviewPoolCardProps = {
  item: CampaignKolItem;
  loadingStatus: SelectionStatus | "undo" | null;
  onApprove: (item: CampaignKolItem) => void;
  onHold: (item: CampaignKolItem) => void;
  onUndo: (item: CampaignKolItem) => void;
  onReject: (item: CampaignKolItem) => void;
  onQuestion: (item: CampaignKolItem) => void;
  onHistory: (item: CampaignKolItem) => void;
};

export function ReviewPoolCard({ item, loadingStatus, onApprove, onHold, onUndo, onReject, onQuestion, onHistory }: ReviewPoolCardProps) {
  const status = item.currentState.currentStatus;
  const reviewStatus = status === "approved" ? "approve" : status === "rejected" ? "reject" : status === "question" ? "question" : status === "hold" ? "hold" : "";
  const audienceFit = Number(item.kol.metadata.audienceFit ?? 0);
  const tier = tierFromFit(audienceFit);
  const sourceList = Array.isArray(item.kol.metadata.previousExamples) ? item.kol.metadata.previousExamples.map(String) : [];

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
          <a className="expanded-kol-avatar" href={item.kol.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.kol.name}`}>
            <img src={item.kol.avatarUrl} alt="" loading="lazy" />
          </a>
          <div className="expanded-kol-name">
            <a href={item.kol.profileUrl} target="_blank" rel="noreferrer">
              {item.kol.name}
              <ExternalLink size={12} />
            </a>
            <span>
              {item.kol.handle} · {formatCompactNumber(item.kol.followers)}
            </span>
          </div>
        </div>
        <span className="expanded-score">{audienceFit || "NA"}</span>
      </div>

      <div className="expanded-tags">
        <span>{tier.label}</span>
        <span>{item.kol.platform}</span>
        <span>{item.kol.contentCategory}</span>
        <span>{item.contactStatus}</span>
        {item.riskTags.slice(0, 2).map((risk) => (
          <span className={risk === "none" ? "" : "warn"} key={risk}>
            {risk.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <p>{item.whyIncluded}</p>
      <div className="expanded-next">
        <b>下一步：</b>
        {item.recommendedAngle}
      </div>

      {status !== "pending" && (
        <div className="review-current">
          <strong>{statusLabels[status]}</strong>
          <span>{item.currentState.currentReasonTags.map((tag) => tag.replaceAll("_", " ")).join(", ") || "saved"}</span>
          {item.currentState.currentNote && <p>{item.currentState.currentNote}</p>}
        </div>
      )}

      <details>
        <summary>证据 / 标签来源</summary>
        <dl>
          <div>
            <dt>Root visibility</dt>
            <dd>{item.kol.audienceSummary}</dd>
          </div>
          <div>
            <dt>Traffic / contact</dt>
            <dd>
              {formatCompactNumber(item.kol.followers)} followers；{item.estimatedPrice || "price pending"}；{item.contactStatus}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{sourceList.length > 0 ? sourceList.join(" / ") : item.clientFacingNote}</dd>
          </div>
        </dl>
      </details>

      <div className="review-mini-panel" aria-label={`Review ${item.kol.name}`}>
        <div className="review-decision-row">
          <DecisionButton
            className="approve"
            selected={status === "approved"}
            loading={loadingStatus === "approved"}
            onClick={() => onApprove(item)}
            icon={<BadgeCheck size={14} />}
            label="Approve"
          />
          <DecisionButton
            className="reject"
            selected={status === "rejected"}
            loading={loadingStatus === "rejected"}
            onClick={() => onReject(item)}
            icon={<XCircle size={14} />}
            label="Reject"
          />
          <DecisionButton
            className="question"
            selected={status === "question"}
            loading={loadingStatus === "question"}
            onClick={() => onQuestion(item)}
            icon={<CircleHelp size={14} />}
            label="Question"
          />
        </div>
        <div className="review-utility-row">
          <button className="review-utility" type="button" onClick={() => onHold(item)} disabled={status === "hold" || loadingStatus === "hold"}>
            {loadingStatus === "hold" ? <span className="spinner" /> : <Clock3 size={14} />}
            Hold
          </button>
          <button className="review-utility" type="button" onClick={() => onHistory(item)}>
            <History size={14} />
            History
          </button>
          {status !== "pending" && (
            <button className="review-utility" type="button" onClick={() => onUndo(item)} disabled={loadingStatus === "undo"}>
              {loadingStatus === "undo" ? <span className="spinner" /> : <RotateCcw size={14} />}
              Undo
            </button>
          )}
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
  if (fit >= 88) return { className: "tier-a", label: "A / priority" };
  if (fit >= 80) return { className: "tier-b", label: "B / validate" };
  if (fit >= 70) return { className: "tier-c", label: "C / backup" };
  return { className: "tier-d", label: "D / observe" };
}
