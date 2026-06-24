import { BadgeCheck, ExternalLink, XCircle } from "lucide-react";
import { formatReasonTag, formatTime, statusLabels } from "../lib/status";
import type { DecisionHistoryEntry, DecisionHistoryResponse } from "../lib/types";

type DecisionHistoryPanelProps = {
  history: DecisionHistoryResponse | null;
  loading: boolean;
};

export function DecisionHistoryPanel({ history, loading }: DecisionHistoryPanelProps) {
  const approved = history?.approved ?? [];
  const rejected = history?.rejected ?? [];

  return (
    <section className="decision-history-panel" aria-label="通过和排除历史记录">
      <div className="decision-history-head">
        <div>
          <span>历史记录</span>
          <strong>通过 / 排除</strong>
        </div>
        <small>{loading ? "正在同步" : `共 ${approved.length + rejected.length} 条`}</small>
      </div>

      <div className="decision-history-grid">
        <HistoryColumn tone="approve" title="通过历史" entries={approved} emptyText="暂无通过记录" />
        <HistoryColumn tone="reject" title="排除历史" entries={rejected} emptyText="暂无排除记录" />
      </div>
    </section>
  );
}

function HistoryColumn({
  tone,
  title,
  entries,
  emptyText
}: {
  tone: "approve" | "reject";
  title: string;
  entries: DecisionHistoryEntry[];
  emptyText: string;
}) {
  const Icon = tone === "approve" ? BadgeCheck : XCircle;

  return (
    <section className={`decision-history-column ${tone}`}>
      <div className="decision-history-column-head">
        <Icon size={15} />
        <strong>{title}</strong>
        <span>{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <div className="decision-history-empty">{emptyText}</div>
      ) : (
        <ol className="decision-history-list">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.currentStatus !== entry.toStatus ? "is-superseded" : ""}>
              <div className="decision-history-item-head">
                {entry.kolProfileUrl ? (
                  <a href={entry.kolProfileUrl} target="_blank" rel="noreferrer">
                    {entry.kolName ?? "Unknown KOL"}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <strong>{entry.kolName ?? "Unknown KOL"}</strong>
                )}
                <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
              </div>

              <div className="decision-history-meta">
                <span>{entry.kolHandle ?? entry.kolId ?? "无 handle"}</span>
                <span>{formatActorRole(entry.actorRole)}</span>
                {entry.currentStatus !== entry.toStatus && <span>当前{statusLabels[entry.currentStatus]}</span>}
              </div>

              {entry.reasonTags.length > 0 && (
                <div className="decision-history-tags">
                  {entry.reasonTags.map((tag) => (
                    <span key={tag}>{formatReasonTag(tag)}</span>
                  ))}
                </div>
              )}

              {entry.note && <p>{entry.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatActorRole(value: string) {
  if (value === "client") return "客户";
  if (value === "agency") return "团队";
  if (value === "system") return "系统";
  return value;
}
