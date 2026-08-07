import type { SVGProps } from 'react';

export default function QloBotMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="6" y="8" width="52" height="42" rx="14" fill="#1B53F0" />
      <path d="M18 48 L14 58 L30 50 Z" fill="#1B53F0" />
      <circle cx="24" cy="29" r="5" fill="#22D3EE" />
      <circle cx="40" cy="29" r="5" fill="#22D3EE" />
    </svg>
  );
}
