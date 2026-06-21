import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, HelpCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { questionReasons, rejectReasons } from "../lib/status";
import type { CampaignKolItem, SelectionStatus } from "../lib/types";

type DecisionModalProps = {
  kind: "reject" | "question";
  item: CampaignKolItem | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: { toStatus: SelectionStatus; reasonTags: string[]; note: string }) => void;
};

export function DecisionModal({ kind, item, submitting, onClose, onSubmit }: DecisionModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reasonOptions = useMemo(() => (kind === "reject" ? rejectReasons : questionReasons), [kind]);

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

  const title = kind === "reject" ? "Reject candidate" : "Ask for more information";
  const helper =
    kind === "reject"
      ? "Select at least one reason so the agency can avoid repeating the same mismatch."
      : "Choose what is missing and write the exact follow-up the agency should answer.";
  const invalid = selected.length === 0 || (kind === "question" && note.trim().length === 0);

  const toggle = (tag: string) => {
    setSelected((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  };

  const submit = () => {
    setAttempted(true);
    if (invalid) return;
    onSubmit({
      toStatus: kind === "reject" ? "rejected" : "question",
      reasonTags: selected,
      note: note.trim()
    });
  };

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div
          className="decision-modal"
          role="dialog"
          aria-modal="true"
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
            <button type="button" className="icon-action" onClick={onClose} aria-label="Close modal">
              <X size={18} />
            </button>
          </div>

          <p className="modal-helper">{helper}</p>

          <div className="reason-grid" aria-label={kind === "reject" ? "Reject reasons" : "Question types"}>
            {reasonOptions.map(([value, label]) => (
              <button key={value} type="button" className={selected.includes(value) ? "selected" : ""} onClick={() => toggle(value)}>
                {selected.includes(value) && <Check size={14} />}
                {label}
              </button>
            ))}
          </div>

          <label className="note-field">
            <span>{kind === "reject" ? "Optional note" : "Question for agency"}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={kind === "reject" ? "Add context for the agency team" : "What should the agency confirm before you decide?"}
              rows={4}
            />
          </label>

          {attempted && selected.length === 0 && <div className="form-error">Select at least one reason.</div>}
          {attempted && kind === "question" && note.trim().length === 0 && <div className="form-error">Write the question the agency should answer.</div>}

          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={`submit-button ${kind}`} onClick={submit} disabled={submitting}>
              {submitting ? <span className="spinner" /> : null}
              Save {kind === "reject" ? "rejection" : "question"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
