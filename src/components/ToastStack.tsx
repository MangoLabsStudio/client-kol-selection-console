import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type Toast = {
  id: string;
  tone: "success" | "danger" | "info";
  message: string;
};

type ToastStackProps = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

const icons = {
  success: CheckCircle2,
  danger: AlertCircle,
  info: Info
};

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = icons[toast.tone];
          return (
            <motion.div
              className={`toast tone-${toast.tone}`}
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <Icon size={18} />
              <span>{toast.message}</span>
              <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss message">
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
