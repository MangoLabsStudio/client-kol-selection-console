import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  HelpCircle,
  History,
  ShieldAlert,
  Sparkles,
  Undo2,
  XCircle
} from "lucide-react";
import { useState } from "react";
import type { CampaignKolItem, SelectionStatus } from "../lib/types";
import { formatCompactNumber, formatContactStatus, formatContentCategory, formatReasonTag, formatRiskTag, formatTime, statusLabels, statusTone } from "../lib/status";

type KolCardProps = {
  item: CampaignKolItem;
  loadingStatus: SelectionStatus | "undo" | null;
  onApprove: (item: CampaignKolItem) => void;
  onHold: (item: CampaignKolItem) => void;
  onUndo: (item: CampaignKolItem) => void;
  onReject: (item: CampaignKolItem) => void;
  onQuestion: (item: CampaignKolItem) => void;
  onHistory: (item: CampaignKolItem) => void;
};

export function KolCard({ item, loadingStatus, onApprove, onHold, onUndo, onReject, onQuestion, onHistory }: KolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const status = item.currentState.currentStatus;
  const audienceFit = Number(item.kol.metadata.audienceFit ?? 0);
  const previousExamples = Array.isArray(item.kol.metadata.previousExamples) ? item.kol.metadata.previousExamples : [];

  return (
    <motion.article
      layout
      className={`kol-card status-${status}`}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <div className="status-strip" aria-hidden />
      <div className="kol-card-head">
        <img className="avatar" src={item.kol.avatarUrl} alt="" loading="lazy" />
        <div className="kol-identity">
          <div className="identity-line">
            <h2>{item.kol.name}</h2>
            <a href={item.kol.profileUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.kol.name} 主页`}>
              <ExternalLink size={16} />
            </a>
          </div>
          <div className="identity-meta">
            <span>{item.kol.handle}</span>
            <span>{item.kol.platform}</span>
            <span>{formatCompactNumber(item.kol.followers)} 粉丝</span>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="kol-card-tags" aria-label="候选账号标签">
        <span>{formatContentCategory(item.kol.contentCategory)}</span>
        <span>{item.kol.region}</span>
        <span>{item.kol.language}</span>
        {item.estimatedPrice && <span>{item.estimatedPrice}</span>}
      </div>

      <section className="angle-block">
        <div className="block-label">
          <Sparkles size={15} />
          建议角度
        </div>
        <p>{item.recommendedAngle}</p>
      </section>

      <section className="note-block">
        <div className="block-label">客户备注</div>
        <p>{item.clientFacingNote}</p>
      </section>

      <div className="signal-row">
        <div>
          <small>受众匹配度</small>
          <strong>{audienceFit ? `${audienceFit}%` : "待评估"}</strong>
        </div>
        <div>
          <small>联系状态</small>
          <strong>{formatContactStatus(item.contactStatus)}</strong>
        </div>
      </div>

      {item.riskTags.length > 0 && (
        <div className="risk-row" aria-label="风险提示">
          <ShieldAlert size={15} />
          {item.riskTags.slice(0, 3).map((tag) => (
            <span key={tag}>{formatRiskTag(tag)}</span>
          ))}
        </div>
      )}

      {status !== "pending" && (
        <motion.div className="decision-note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <strong>{statusLabels[status]}</strong>
          <span>
            {item.currentState.currentReasonTags.length > 0 ? item.currentState.currentReasonTags.map(formatReasonTag).join("，") : "已记录"}
          </span>
          {item.currentState.currentNote && <p>{item.currentState.currentNote}</p>}
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="expanded-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div>
              <div className="block-label">入选理由</div>
              <p>{item.whyIncluded}</p>
            </div>
            <div>
              <div className="block-label">目标受众</div>
              <p>{item.kol.audienceSummary}</p>
            </div>
            {previousExamples.length > 0 && (
              <div>
                <div className="block-label">参考内容</div>
                <div className="example-list">
                  {previousExamples.map((example) => (
                    <span key={String(example)}>{String(example)}</span>
                  ))}
                </div>
              </div>
            )}
            {item.agencyInternalNote && (
              <div className="internal-note">
                <div className="block-label">团队备注</div>
                <p>{item.agencyInternalNote}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card-toolbar">
        <button type="button" className="quiet-button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          详情
        </button>
        <button type="button" className="quiet-button" onClick={() => onHistory(item)}>
          <History size={16} />
          记录
        </button>
        <span>更新于 {formatTime(item.currentState.lastUpdatedAt)}</span>
      </div>

      <div className="decision-actions" aria-label={`评审 ${item.kol.name}`}>
        <ActionButton
          tone="success"
          active={status === "approved"}
          loading={loadingStatus === "approved"}
          onClick={() => onApprove(item)}
          icon={<BadgeCheck size={17} />}
          label={status === "approved" ? "已通过" : "通过"}
        />
        <ActionButton
          tone="danger"
          active={status === "rejected"}
          loading={loadingStatus === "rejected"}
          onClick={() => onReject(item)}
          icon={<XCircle size={17} />}
          label={status === "rejected" ? "已排除" : "排除"}
        />
        <ActionButton
          tone="info"
          active={status === "question"}
          loading={loadingStatus === "question"}
          onClick={() => onQuestion(item)}
          icon={<HelpCircle size={17} />}
          label={status === "question" ? "待补充" : "需补充"}
        />
        <ActionButton
          tone="warning"
          active={status === "hold"}
          loading={loadingStatus === "hold"}
          onClick={() => onHold(item)}
          icon={<Clock3 size={17} />}
          label={status === "hold" ? "已暂缓" : "暂缓"}
        />
        {status !== "pending" && (
          <button className="undo-button" type="button" onClick={() => onUndo(item)} disabled={loadingStatus === "undo"} aria-label={`撤回 ${item.kol.name} 的评审`}>
            {loadingStatus === "undo" ? <span className="spinner" /> : <Undo2 size={16} />}
          </button>
        )}
      </div>
    </motion.article>
  );
}

function StatusBadge({ status }: { status: SelectionStatus }) {
  return <span className={`status-badge tone-${statusTone[status]}`}>{statusLabels[status]}</span>;
}

function ActionButton({
  label,
  icon,
  tone,
  active,
  loading,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  tone: string;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`decision-button tone-${tone} ${active ? "active" : ""}`} onClick={onClick} disabled={loading || active} aria-pressed={active}>
      {loading ? <span className="spinner" /> : icon}
      <span>{label}</span>
    </button>
  );
}
