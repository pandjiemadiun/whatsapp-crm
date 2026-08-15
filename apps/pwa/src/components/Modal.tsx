import { type ReactNode, useEffect } from 'react';

export default function Modal({
  title,
  open,
  onClose,
  children,
  actionLabel,
  onAction,
  actionVariant = 'primary',
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'destructive';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-xl mx-3 my-4 p-4 overflow-y-auto max-h-[80dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-serif font-semibold text-lg text-foreground mb-3">{title}</h3>
        <div className="text-sm text-foreground/80 break-words leading-relaxed max-h-[56dvh] overflow-y-auto">
          {children}
        </div>
        <div className="mt-4 flex gap-2.5 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-bold text-foreground bg-muted hover:bg-muted/80 transition-colors"
          >
            Tutup
          </button>
          {actionLabel ? (
            <button
              type="button"
              onClick={() => { onAction?.(); onClose(); }}
              className="px-4 py-2 rounded-full text-xs font-bold text-white border-0 transition-colors"
              style={{ background: actionVariant === 'destructive' ? '#d32f2f' : 'var(--forest)' }}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
