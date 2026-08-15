import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
type BadgeColor = 'default' | 'secondary' | 'outline' | 'destructive';

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  color?: BadgeColor;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
};

const colorClasses: Record<BadgeColor, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-destructive-foreground',
};

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', color, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'badge-base',
        color ? colorClasses[color] : variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
);

Badge.displayName = 'Badge';
