import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Download, FileJson, HelpCircle, LockKeyhole, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import type { ActorRole, Campaign, SelectionStatus, Summary } from "../lib/types";
import { formatTime, statusLabels } from "../lib/status";

type SummaryBarProps = {
  campaign: Campaign;
  summary: Summary;
  actorRole: ActorRole;
  exporting: boolean;
  locking: boolean;
  onExport: (format: "json" | "csv") => void;
  onLock: () => void;
  onRoleChange: (role: ActorRole) => void;
};

const statusMeta: Array<{ status: SelectionStatus; icon: React.ComponentType<{ size?: number }> }> = [
  { status: "approved", icon: CheckCircle2 },
  { status: "rejected", icon: XCircle },
  { status: "question", icon: HelpCircle },
  { status: "pending", icon: Sparkles }
];

export function SummaryBar({ campaign, summary, actorRole, exporting, locking, onExport, onLock, onRoleChange }: SummaryBarProps) {
  const reviewed = summary.total - summary.pending;
  const progress = summary.total > 0 ? Math.round((reviewed / summary.total) * 100) : 0;

  return (
    <header className="summary-bar" aria-label="项目评审摘要">
      <div className="summary-main">
        <div className="client-mark">
          <ShieldCheck size={18} aria-hidden />
        </div>
        <div className="summary-title">
          <div className="summary-kicker">
            {campaign.clientName} · {campaign.reviewRound}
          </div>
          <h1>{campaign.name}</h1>
          <p>{campaign.objective}</p>
        </div>
      </div>

      <div className="summary-progress" aria-label={`已评审 ${progress}%`}>
        <div>
          <span>{progress}%</span>
          <small>已评审</small>
        </div>
        <div className="progress-track">
          <motion.div className="progress-fill" animate={{ width: `${progress}%` }} transition={{ type: "spring", stiffness: 100, damping: 22 }} />
        </div>
      </div>

      <div className="summary-counts">
        <CountPill label="全部" value={summary.total} tone="total" />
        {statusMeta.map(({ status, icon: Icon }) => (
          <CountPill key={status} label={statusLabels[status]} value={summary[status]} tone={status} icon={Icon} />
        ))}
      </div>

      <div className="summary-actions">
        <div className="role-switch" aria-label="评审视图">
          <button className={actorRole === "client" ? "active" : ""} onClick={() => onRoleChange("client")} type="button">
            客户视图
          </button>
          <button className={actorRole === "agency" ? "active" : ""} onClick={() => onRoleChange("agency")} type="button">
            团队视图
          </button>
        </div>
        <div className="summary-updated">
          <span>最近更新</span>
          <strong>{formatTime(campaign.lastUpdatedAt)}</strong>
        </div>
        <button className="icon-action" type="button" onClick={() => onExport("json")} disabled={exporting} aria-label="导出 JSON">
          <FileJson size={18} />
        </button>
        <button className="text-action" type="button" onClick={() => onExport("csv")} disabled={exporting}>
          <Download size={17} />
          {exporting ? "导出中" : "CSV"}
        </button>
        {actorRole !== "client" && (
          <button className="text-action lock-action" type="button" onClick={onLock} disabled={locking || Boolean(campaign.lockedAt)}>
            <LockKeyhole size={17} />
            {campaign.lockedAt ? "已锁定" : locking ? "锁定中" : "锁定版本"}
          </button>
        )}
      </div>
    </header>
  );
}

function CountPill({
  label,
  value,
  tone,
  icon: Icon
}: {
  label: string;
  value: number;
  tone: string;
  icon?: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className={`count-pill tone-${tone}`}>
      {Icon && <Icon size={16} aria-hidden />}
      <span>{label}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.strong
          key={value}
          initial={{ y: -7, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 7, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {value}
        </motion.strong>
      </AnimatePresence>
    </div>
  );
}
