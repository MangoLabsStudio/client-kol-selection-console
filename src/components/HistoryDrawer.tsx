import { AnimatePresence, motion } from "framer-motion";
import { History, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { formatReasonTag, formatTime, statusLabels } from "../lib/status";
import type { CampaignKolItem, SelectionEvent } from "../lib/types";

type HistoryDrawerProps = {
  item: CampaignKolItem | null;
  events: SelectionEvent[];
  loading: boolean;
  onClose: () => void;
};

export function HistoryDrawer({ item, events, loading, onClose }: HistoryDrawerProps) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  return (
    <AnimatePresence>
      {item && (
        <motion.div className="drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="drawer-scrim" type="button" onClick={onClose} aria-label="关闭评审记录" />
          <motion.aside
            className="history-drawer"
            aria-label={`查看 ${item.kol.name} 的评审记录`}
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ type: "spring", stiffness: 230, damping: 28 }}
          >
            <div className="drawer-head">
              <div className="modal-icon history">
                <History size={19} />
              </div>
              <div>
                <h2>评审记录</h2>
                <p>
                  {item.kol.name} · {item.kol.handle}
                </p>
              </div>
              <button type="button" className="icon-action" onClick={onClose} aria-label="关闭评审记录">
                <X size={18} />
              </button>
            </div>

            {loading ? (
              <div className="drawer-loading">
                <Loader2 size={20} className="spin" />
                正在加载评审记录
              </div>
            ) : events.length === 0 ? (
              <div className="drawer-empty">暂无评审记录。</div>
            ) : (
              <ol className="history-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <div className="history-dot" aria-hidden />
                    <div className="history-event">
                      <div className="history-event-head">
                        <strong>{formatEventType(event.eventType)}</strong>
                        <span>{formatTime(event.createdAt)}</span>
                      </div>
                      <p>{formatStatusChange(event)}</p>
                      <small>
                        {formatActorRole(event.actorRole)} · {event.actorId}
                      </small>
                      {event.reasonTags.length > 0 && (
                        <div className="history-tags">
                          {event.reasonTags.map((tag) => (
                            <span key={tag}>{formatReasonTag(tag)}</span>
                          ))}
                        </div>
                      )}
                      {event.note && <blockquote>{event.note}</blockquote>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function formatEventType(value: string) {
  const labels: Record<string, string> = {
    decision_created: "新增评审",
    decision_changed: "更新评审",
    reason_updated: "更新原因",
    undo: "撤回评审"
  };

  return labels[value] ?? value;
}

function formatStatusChange(event: SelectionEvent) {
  const fromStatus = event.fromStatus && event.fromStatus in statusLabels ? statusLabels[event.fromStatus as keyof typeof statusLabels] : "初始状态";
  const toValue = event.toStatus ?? event.decision;
  const toStatus = toValue && toValue in statusLabels ? statusLabels[toValue as keyof typeof statusLabels] : "已记录";

  return `${fromStatus} → ${toStatus}`;
}

function formatActorRole(value: string) {
  if (value === "client") return "客户";
  if (value === "agency") return "团队";
  return value;
}
