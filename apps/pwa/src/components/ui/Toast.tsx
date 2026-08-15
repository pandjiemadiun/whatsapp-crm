import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'destructive';

type ToastBase = Omit<HTMLAttributes<HTMLDivElement>, 'title'>;

export interface ToastProps extends ToastBase {
  variant?: ToastVariant;
  title: ReactNode;
  description?: ReactNode;
}

const variantClasses: Record<ToastVariant, string> = {
  default: 'toast-default',
  destructive: 'toast-destructive',
};

export const Toast = forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant = 'default', title, description, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('toast', variantClasses[variant], className)}
      {...props}
    >
      <div className="flex-1">
        <div className="toast-title">{title}</div>
        {description ? (
          <div className="toast-description">{description}</div>
        ) : null}
      </div>
    </div>
  ),
);

Toast.displayName = 'Toast';

export type ToastViewportProps = HTMLAttributes<HTMLDivElement>;

export const ToastViewport = forwardRef<HTMLDivElement, ToastViewportProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('toast-viewport', className)}
      {...props}
    />
  ),
);

ToastViewport.displayName = 'ToastViewport';

export type ToastActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  onPress?: () => void;
};

export const ToastAction = forwardRef<HTMLButtonElement, ToastActionProps>(
  ({ className, label = 'OK', onPress, ...props }, ref) => (
    <button
      ref={ref}
      onClick={onPress}
      className={cn(
        'shrink-0 border-0 bg-transparent text-sm font-semibold text-primary hover:underline',
        className,
      )}
      {...props}
    >
      {label}
    </button>
  ),
);

ToastAction.displayName = 'ToastAction';
