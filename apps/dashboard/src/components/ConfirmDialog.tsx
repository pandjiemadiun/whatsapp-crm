import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  title?: string;
  message: string;
  consequence?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title = 'Konfirmasi',
  message,
  consequence,
  confirmLabel = 'Hapus',
  cancelLabel = 'Batal',
  confirmClass = 'bg-red-600 hover:bg-red-700',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-dcard rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-ink dark:text-surface mb-1">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-muted leading-relaxed break-words">{message}</p>
            {consequence && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 italic">{consequence}</p>
            )}
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 dark:bg-dline text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition flex items-center gap-1.5"
          >
            <X className="w-3 h-3" />
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-lg text-sm font-medium transition ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
