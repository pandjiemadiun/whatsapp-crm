import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TextVariant =
  | 'display'
  | 'heading'
  | 'title'
  | 'body'
  | 'caption'
  | 'footnote';

export type TextTag = 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const TAG_MAP: Record<TextVariant, TextTag> = {
  display: 'h1',
  heading: 'h2',
  title: 'h3',
  body: 'p',
  caption: 'span',
  footnote: 'span',
};

export type TextProps = HTMLAttributes<HTMLElement> & {
  variant?: TextVariant;
  as?: TextTag;
  children?: ReactNode;
};

const variantClasses: Record<TextVariant, string> = {
  display: 'text-display',
  heading: 'text-heading',
  title: 'text-title',
  body: 'text-body',
  caption: 'text-caption',
  footnote: 'text-footnote',
};

export function Text({ className, variant = 'body', as, children, ...props }: TextProps) {
  const Tag: TextTag = as ?? TAG_MAP[variant];
  return (
    <Tag className={cn(variantClasses[variant], className)} {...props}>
      {children}
    </Tag>
  );
}

Text.displayName = 'Text';
