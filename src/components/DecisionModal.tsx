import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, HelpCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { questionReasons, rejectReasons } from "../lib/status";
import type { CampaignKolItem, SelectionStatus } from "../lib/types";

export type FeedbackAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DecisionModalProps = {
  kind: "reject" | "question";
  item: CampaignKolItem | null;
  anchor: FeedbackAnchor | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: { toStatus: SelectionStatus; reasonTags: string[]; note: string }) => void;
  onReasonToggle?: (input: { tag: string; selected: boolean; currentTags: string[] }) => void;
  onSubmitAttempt?: (input: { valid: boolean; toStatus: SelectionStatus; reasonTags: string[]; note: string; error: string | null }) => void;
};

export function DecisionModal({ kind, item, anchor, submitting, onClose, onSubmit, onReasonToggle, onSubmitAttempt }: DecisionModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reasonOptions = useMemo(() => (kind === "reject" ? rejectReasons : questionReasons), [kind]);
  const floatingStyle = useMemo(() => getFloatingStyle(anchor), [anchor]);

  useEffect(() => {
    if (!item) return;
    setSelected([]);
    setNote("");
    setAttempted(false);
  }, [item, kind]);

  useEffect(() => {
    if (!item) return;
    const first = panelRef.current?.querySelector<HTMLElement>("button, textarea");
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button, textarea, input, select, [tabindex]:not([tabindex='-1'])")).filter(
        (element) => !element.hasAttribute("disabled")
      );
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const title = kind === "reject" ? "排除候选账号" : "请求补充信息";
  const helper =
    kind === "reject"
      ? "选择一个主要原因即可；如需补充细节，可写在下方说明里。"
      : "选择一个最需要补充的信息类型，并写明要确认的问题。";
  const requiresNote = kind === "question" || (kind === "reject" && selected.includes("other"));
  const invalid = selected.length === 0 || (requiresNote && note.trim().length === 0);

  const toggle = (tag: string) => {
    setSelected((current) => {
      const next = current.includes(tag) ? [] : [tag];
      onReasonToggle?.({ tag, selected: next.includes(tag), currentTags: next });
      return next;
    });
  };

  const submit = () => {
    setAttempted(true);
    const toStatus = kind === "reject" ? "rejected" : "question";
    const error = selected.length === 0 ? "missing_reason" : requiresNote && note.trim().length === 0 ? "missing_note" : null;
    onSubmitAttempt?.({
      valid: !error,
      toStatus,
      reasonTags: selected,
      note: note.trim(),
      error
    });
    if (invalid) return;
    onSubmit({
      toStatus,
      reasonTags: selected,
      note: note.trim()
    });
  };

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" style={floatingStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div
          className="decision-modal"
          role="dialog"
          aria-modal="false"
          aria-labelledby="decision-modal-title"
          ref={panelRef}
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 260, damping: 25 }}
        >
          <div className="modal-head">
            <div className={`modal-icon ${kind}`}>
              {kind === "reject" ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
            </div>
            <div>
              <h2 id="decision-modal-title">{title}</h2>
              <p>
                {item.kol.name} · {item.kol.handle}
              </p>
            </div>
            <button type="button" className="icon-action" onClick={onClose} aria-label="关闭弹窗">
              <X size={18} />
            </button>
          </div>

          <p className="modal-helper">{helper}</p>

          <div className="reason-grid" aria-label={kind === "reject" ? "排除原因" : "补充信息类型"}>
            {reasonOptions.map(([value, label]) => (
              <button key={value} type="button" className={selected.includes(value) ? "selected" : ""} onClick={() => toggle(value)}>
                {selected.includes(value) && <Check size={14} />}
                {label}
              </button>
            ))}
          </div>

          <label className="note-field">
            <span>{kind === "reject" ? "客户补充说明" : "需确认的问题"}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={kind === "reject" ? "可写具体顾虑、内部判断或替代建议" : "请写明需要补充确认的信息"}
              rows={3}
            />
          </label>

          {attempted && selected.length === 0 && <div className="form-error">请至少选择一个原因。</div>}
          {attempted && requiresNote && note.trim().length === 0 && (
            <div className="form-error">{kind === "reject" ? "选择其他原因时，请写明具体说明。" : "请写明需要补充确认的问题。"}</div>
          )}

          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              取消
            </button>
            <button type="button" className={`submit-button ${kind}`} onClick={submit} disabled={submitting}>
              {submitting ? <span className="spinner" /> : null}
              {kind === "reject" ? "保存排除意见" : "发送补充请求"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function getFloatingStyle(anchor: FeedbackAnchor | null): CSSProperties {
  if (typeof window === "undefined") {
    return {};
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportWidth < 720 ? 12 : 16;
  const gap = viewportWidth < 720 ? 8 : 12;
  const width = Math.min(430, Math.max(280, viewportWidth - margin * 2));
  const estimatedHeight = viewportWidth < 720 ? 360 : 353;
  const maxTop = Math.max(margin, viewportHeight - estimatedHeight - margin);

  if (!anchor) {
    return {
      left: Math.round((viewportWidth - width) / 2),
      top: margin + 24,
      width
    };
  }

  const rightOfTrigger = anchor.left + anchor.width + gap;
  const leftOfTrigger = anchor.left - width - gap;
  const centeredOnTrigger = anchor.left + anchor.width / 2 - width / 2;
  const hasRoomRight = rightOfTrigger + width <= viewportWidth - margin;
  const hasRoomLeft = leftOfTrigger >= margin;
  const preferredLeft = hasRoomRight ? rightOfTrigger : hasRoomLeft ? leftOfTrigger : centeredOnTrigger;

  return {
    left: Math.round(clamp(preferredLeft, margin, viewportWidth - width - margin)),
    top: Math.round(clamp(anchor.top - 10, margin, maxTop)),
    width
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
