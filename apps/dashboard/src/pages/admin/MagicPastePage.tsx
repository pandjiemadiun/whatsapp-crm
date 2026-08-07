import { useState, useEffect } from 'react';
import { Wand2, Database } from 'lucide-react';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { MagicPastePanel } from '../../components/admin/MagicPastePanel';
import { MagicPasteConfigPanel } from '../../components/admin/MagicPasteConfigPanel';

export default function MagicPastePage() {
  const { admin } = useAdminAuth();
  const [tab, setTab] = useState<'tool' | 'config'>('tool');

  // Force dark mode ON
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  if (!admin) {
    return null;
  }

  return (
    <div className="p-4 sm:p-6 text-surface">
      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 p-1 bg-dline/20 rounded-lg text-sm font-medium max-w-md">
        <button
          onClick={() => setTab('tool')}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition ${
            tab === 'tool'
              ? 'bg-brand text-white shadow'
              : 'text-slate-400 hover:text-surface hover:bg-dcard'
          }`}
        >
          <Wand2 className="w-4 h-4" />
          Extract
        </button>
        <button
          onClick={() => setTab('config')}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition ${
            tab === 'config'
              ? 'bg-brand text-white shadow'
              : 'text-slate-400 hover:text-surface hover:bg-dcard'
          }`}
        >
          <Database className="w-4 h-4" />
          Pattern Library
        </button>
      </div>

      {tab === 'tool' ? (
        <MagicPastePanel token={admin.token} />
      ) : (
        <MagicPasteConfigPanel token={admin.token} />
      )}
    </div>
  );
}
