import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Bot } from 'lucide-react';
import api from '../services/api';

export default function AiSettings() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const charCount = prompt.length;
  const maxChars = 2000;

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    api.get('/settings/ai')
      .then((res) => setPrompt(res.data.data.systemPrompt || ''))
      .catch(() => showFeedback('error', 'Failed to load AI settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!prompt.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.put('/settings/ai', { systemPrompt: prompt.trim() });
      if (res.data.success) {
        showFeedback('success', 'AI system prompt saved successfully');
      }
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/dashboard')} className="text-muted hover:text-ink focus-visible:ring-2 focus:ring-brand rounded transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-ink dark:text-surface">AI Settings</h1>
            <p className="text-sm text-muted">Configure AI behavior and system prompt</p>
          </div>
        </div>
        <div className="space-y-4 max-w-2xl">
          <div className="h-4 w-1/3 rounded bg-line animate-pulse" />
          <div className="h-40 rounded-lg bg-line animate-pulse" />
          <div className="h-10 w-32 rounded-lg bg-line animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/dashboard')} className="text-muted hover:text-ink focus-visible:ring-2 focus:ring-brand rounded transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-ink dark:text-surface">AI Settings</h1>
          <p className="text-sm text-muted">Configure AI behavior and system prompt</p>
        </div>
      </div>

      {feedback && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium max-w-2xl ${
          feedback.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800'
        }`}>
          {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
        </div>
      )}

      <div className="max-w-2xl space-y-4">
        <div className="bg-surface dark:bg-dcard rounded-xl border border-line dark:border-dline p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-brand" />
            <h2 className="text-sm font-semibold text-ink dark:text-surface">AI System Prompt</h2>
          </div>
          <p className="text-xs text-muted dark:text-gray-500">
            This prompt is sent to the AI model before every customer message. Customize it to control tone, behavior, and business rules.
          </p>

          <div className="space-y-1.5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={saving}
              rows={10}
              placeholder="Enter AI system prompt..."
              className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 resize-y"
            />
            <div className="flex justify-end">
              <span className={`text-xs ${charCount > maxChars ? 'text-red-500 font-medium' : 'text-muted'}`}>
                {charCount} / {maxChars}
              </span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !prompt.trim() || charCount > maxChars}
            className="bg-brand text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-brand-deep disabled:bg-brand/30 focus-visible:ring-2 focus:ring-brand transition flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}
