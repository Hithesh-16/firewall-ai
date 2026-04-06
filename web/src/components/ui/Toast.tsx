import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  dismissToast,
  type Toast as ToastType,
} from "../../store/slices/uiSlice";

const iconMap: Record<ToastType["type"], React.ReactNode> = {
  success: <CheckCircleIcon className="text-success h-5 w-5" />,
  error: <XCircleIcon className="text-error h-5 w-5" />,
  warning: <ExclamationTriangleIcon className="text-warning h-5 w-5" />,
  info: <InformationCircleIcon className="text-info h-5 w-5" />,
};

const borderMap: Record<ToastType["type"], string> = {
  success: "border-success/30",
  error: "border-error/30",
  warning: "border-warning/30",
  info: "border-info/30",
};

function ToastItem({ toast }: { toast: ToastType }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch(dismissToast(toast.id));
    }, 5000);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id]);

  return (
    <div
      className={cn(
        "bg-editor fade-in flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg",
        borderMap[toast.type],
      )}
      role="status"
    >
      {iconMap[toast.type]}
      <p className="text-foreground flex-1 text-sm">{toast.message}</p>
      <button
        onClick={() => dispatch(dismissToast(toast.id))}
        className="text-description hover:text-foreground shrink-0 rounded p-0.5"
        aria-label="Dismiss"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useAppSelector((s) => s.ui.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}
