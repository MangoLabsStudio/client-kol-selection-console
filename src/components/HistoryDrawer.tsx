import { AnimatePresence, motion } from "framer-motion";
import { History, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { formatTime } from "../lib/status";
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
          <button className="drawer-scrim" type="button" onClick={onClose} aria-label="Close history drawer" />
          <motion.aside
            className="history-drawer"
            aria-label={`Selection history for ${item.kol.name}`}
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
                <h2>Decision history</h2>
                <p>
                  {item.kol.name} · {item.kol.handle}
                </p>
              </div>
              <button type="button" className="icon-action" onClick={onClose} aria-label="Close history drawer">
                <X size={18} />
              </button>
            </div>

            {loading ? (
              <div className="drawer-loading">
                <Loader2 size={20} className="spin" />
                Loading history
              </div>
            ) : events.length === 0 ? (
              <div className="drawer-empty">No decision events have been recorded yet.</div>
            ) : (
              <ol className="history-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <div className="history-dot" aria-hidden />
                    <div className="history-event">
                      <div className="history-event-head">
                        <strong>{event.eventType.replaceAll("_", " ")}</strong>
                        <span>{formatTime(event.createdAt)}</span>
                      </div>
                      <p>
                        {event.fromStatus ?? "start"} → {event.toStatus ?? event.decision}
                      </p>
                      <small>
                        {event.actorRole} · {event.actorId}
                      </small>
                      {event.reasonTags.length > 0 && (
                        <div className="history-tags">
                          {event.reasonTags.map((tag) => (
                            <span key={tag}>{tag.replaceAll("_", " ")}</span>
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
