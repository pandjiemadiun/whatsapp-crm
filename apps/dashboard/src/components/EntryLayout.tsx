import { type ReactNode } from 'react';
import { Bot, Users, FileText } from 'lucide-react';
import QloBotMark from './QloBotMark';

type EntryLayoutProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
};

const VALUE_BULLETS = [
  { icon: <Bot className="w-4 h-4 text-brand" />, label: 'Balas otomatis 24/7' },
  { icon: <Users className="w-4 h-4 text-brand" />, label: 'Ingat pelanggan' },
  { icon: <FileText className="w-4 h-4 text-brand" />, label: 'Laporan harian' },
];

export default function EntryLayout({ title, subtitle, children }: EntryLayoutProps) {
  return (
    <div className="min-h-screen bg-surface dark:bg-dsurface flex">
      {/* Desktop split-screen left panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-navy dark:bg-dsurface">
        {/* dot-grid */}
        <div
          className="absolute inset-0 opacity-[0.08] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        {/* soft brand glow */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-brand/20 blur-3xl" />
        <div className="relative z-10 flex flex-col h-full p-12">
          <div className="flex items-center gap-3 mb-6">
            <QloBotMark className="h-9 w-9" />
            <span className="font-display font-bold text-2xl tracking-tight text-white dark:text-surface">QloBot</span>
          </div>
          <div className="mt-8 space-y-6">
            <h2 className="text-3xl font-display font-bold text-white">
              Bot yang mengelola tokomu, 24/7
            </h2>
            <div className="space-y-4">
              {VALUE_BULLETS.map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  {b.icon}
                  <span className="text-slate-300">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto pb-4 pt-8">
            <p className="text-sm text-slate-400">
              “QloBot menghemat 3 jam sehari untuk toko kami.”
            </p>
            <p className="text-xs text-slate-500 mt-1"> — Toko Maju Jaya</p>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="w-full lg:w-1/2 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6 lg:py-12">
          <div className="w-full max-w-md">
            {/* Mobile header: horizontal lockup + title + subtitle */}
            <div className="lg:hidden text-center mb-8">
              <div className="flex items-center justify-center gap-3 mb-6">
                <QloBotMark className="h-11 w-11" />
                <span className="font-display font-bold text-3xl tracking-tight text-ink dark:text-surface">QloBot</span>
              </div>
              {title && (
                <h1 className="text-xl font-semibold text-ink dark:text-surface mb-1">{title}</h1>
              )}
              {subtitle && (
                <p className="text-sm text-muted mb-6">{subtitle}</p>
              )}
            </div>

            {/* Desktop: form is borderless (no card bg) */}
            {/* Mobile: form card */}
            <div className="bg-white dark:bg-dcard lg:bg-transparent lg:shadow-none rounded-xl lg:rounded-none shadow-sm border border-line dark:border-dline lg:border-0 p-6 lg:p-0 space-y-4">
              {children}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="py-6 text-center">
          <p className="text-xs text-muted">
            Privasi · Syarat · Kontak · © 2026 QloBot
          </p>
        </footer>
      </div>
    </div>
  );
}
