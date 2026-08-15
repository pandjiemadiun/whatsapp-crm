import type { ReactNode } from 'react';

export type QuickActionVariant = 'primary' | 'secondary';

export type QuickAction = {
  id: string;
  emoji: ReactNode;
  label: string;
  onPress: () => void;
  variant?: QuickActionVariant;
};

export type QuickActionChipsProps = {
  actions: QuickAction[];
  className?: string;
  layout?: 'row' | 'column';
};

const baseCls =
  'inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[120px] px-5 py-2.5 ' +
  'text-sm font-medium rounded-lg transition-all duration-150 active:scale-[0.98] ' +
  'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:ring-offset-1';

export default function QuickActionChips({
  actions,
  className = '',
  layout = 'row',
}: QuickActionChipsProps) {
  const layoutCls = layout === 'column'
    ? 'flex flex-col w-full gap-2.5'
    : 'flex flex-wrap gap-2.5 justify-center';

  return (
    <div className={`${layoutCls} ${className}`}>
      {actions.map((a) => {
        const isPrimary = a.variant === 'primary';
        return (
          <button
            key={a.id}
            type="button"
            onClick={a.onPress}
            className={
                isPrimary
                  ? `${baseCls} bg-primary text-primary-foreground border border-primary/30 hover:brightness-110 shadow-sm`
                  : `${baseCls} bg-surface text-foreground border border-border hover:bg-muted shadow-sm`
              }
          >
            <span className="flex-shrink-0 text-base" aria-hidden="true">{a.emoji}</span>
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}
