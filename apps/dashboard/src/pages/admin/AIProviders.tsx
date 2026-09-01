import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database,
  ArrowLeft,
  Save,
  Trash2,
  Edit3,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronDown,
  Power,
} from 'lucide-react';
import adminApi from '../../services/adminApi';
import { useAdminAuth } from '../../contexts/AdminAuthContext';

type ProviderFormat = 'openai_compatible' | 'gemini_native';
type ProviderRole = 'chat_primary' | 'chat_fallback' | 'chat_gatekeeper' | 'wizard' | 'other';

interface ProviderRow {
  id: string;
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  apiKey: string | null; // already masked (last4) by the backend — NEVER raw
  model: string;
  role: ProviderRole;
  priority: number;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  modelUsed?: string;
  sampleResponse?: string;
  errorCategory?: string;
  errorMessage?: string;
  statusCode?: number;
}

interface Feedback {
  type: 'success' | 'error';
  msg: string;
}

const FORMAT_OPTIONS: { value: ProviderFormat; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
  { value: 'gemini_native', label: 'Gemini native' },
];
const ROLE_OPTIONS: { value: ProviderRole; label: string }[] = [
  { value: 'chat_primary', label: 'chat_primary — main speaker' },
  { value: 'chat_fallback', label: 'chat_fallback — retry after primary' },
  { value: 'chat_gatekeeper', label: 'chat_gatekeeper — intent extraction' },
  { value: 'wizard', label: 'wizard — onboarding' },
  { value: 'other', label: 'other' },
];

const blankForm = (): ProviderForm => ({
  name: '',
  format: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  role: 'chat_primary',
  priority: 0,
  isActive: true,
});

type ProviderForm = {
  name: string;
  format: ProviderFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  role: ProviderRole;
  priority: number;
  isActive: boolean;
};

export default function AIProviders() {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const isSuperAdmin = admin?.role === 'super_admin';

  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [form, setForm] = useState<ProviderForm>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Per-row test-connection result, rendered inline until re-tested/dismissed.
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [formTestResult, setFormTestResult] = useState<TestResult | null>(null);
  const [testingDraft, setTestingDraft] = useState(false);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/ai-providers');
      setProviders(res.data?.data || []);
    } catch {
      showFeedback('error', 'Gagal memuat daftar AI provider');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Form field handlers ──
  const f = (k: keyof ProviderForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((s) => ({
      ...s,
      [k]: k === 'priority' ? Number(v) : v,
    }));
  };

  const startEdit = (row: ProviderRow) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      format: row.format,
      baseUrl: row.baseUrl,
      apiKey: '', // blank = keep existing on save
      model: row.model,
      role: row.role,
      priority: row.priority,
      isActive: row.isActive,
    });
    setFormTestResult(null);
  };

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
    setFormTestResult(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      showFeedback('error', 'Nama, baseUrl, dan model wajib diisi');
      return;
    }
    // apiKey only required on create (edit leaves it blank to keep existing).
    if (!editingId && !form.apiKey.trim()) {
      showFeedback('error', 'apiKey wajib diisi saat membuat provider baru');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await adminApi.put(`/ai-providers/${editingId}`, {
          name: form.name,
          format: form.format,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          model: form.model,
          role: form.role,
          priority: form.priority,
          isActive: form.isActive,
        });
        showFeedback('success', `Provider '${form.name}' diperbarui`);
      } else {
        await adminApi.post('/ai-providers', {
          name: form.name,
          format: form.format,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          model: form.model,
          role: form.role,
          priority: form.priority,
          isActive: form.isActive,
        });
        showFeedback('success', `Provider '${form.name}' dibuat`);
      }
      await refresh();
      resetForm();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.details || err?.message || 'Gagal menyimpan provider';
      showFeedback('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ProviderRow) => {
    if (!window.confirm(`Hapus provider '${row.name}' (${row.format}/${row.role})? Aksi ini tidak bisa dibatalkan.`)) return;
    try {
      await adminApi.delete(`/ai-providers/${row.id}`);
      showFeedback('success', `Provider '${row.name}' dihapus`);
      await refresh();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal menghapus provider');
    }
  };

  // ── Test-connection ──
  const handleTestDraft = async () => {
    if (!form.baseUrl || !form.apiKey || !form.model) {
      showFeedback('error', 'Isi baseUrl, apiKey, dan model untuk test koneksi draft');
      return;
    }
    setTestingDraft(true);
    setFormTestResult(null);
    try {
      const res = await adminApi.post('/ai-providers/test-connection', {
        format: form.format,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        model: form.model,
      });
      setFormTestResult(res.data?.data);
    } catch (err: any) {
      setFormTestResult(err?.response?.data?.data || { success: false, errorCategory: 'UNKNOWN', errorMessage: err?.message });
    } finally {
      setTestingDraft(false);
    }
  };

  const handleTestRow = async (row: ProviderRow) => {
    setTestResults((s) => ({ ...s, [row.id]: { success: undefined as any, latencyMs: 0 } }));
    try {
      const res = await adminApi.post(`/ai-providers/${row.id}/test-connection`);
      setTestResults((s) => ({ ...s, [row.id]: res.data?.data }));
    } catch (err: any) {
      setTestResults((s) => ({ ...s, [row.id]: err?.response?.data?.data || { success: false, errorCategory: 'UNKNOWN', errorMessage: err?.message } }));
    }
  };

  const dismissRowTest = (id: string) => setTestResults((s) => {
    const copy = { ...s };
    delete copy[id];
    return copy;
  });

  // ── Render ──
  if (loading) {
    return (
      <div className="p-6 text-surface">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-5 h-5" />
          <div>
            <h1 className="font-display text-xl text-surface">AI Providers</h1>
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-dline/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-surface">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin/config')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">AI Providers</h1>
          <p className="text-sm text-slate-400">
            Manage LLM provider configs (format/baseUrl/model/role/priority). Test connection before &amp; after save.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            feedback.type === 'success'
              ? 'bg-cyan/10 text-cyan border border-cyan/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
        </div>
      )}

      {!isSuperAdmin && (
        <div className="mb-4 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-300 text-sm">
          Hanya super_admin yang dapat mengelola AI provider. Read-only view di bawah.
        </div>
      )}

      {/* ── Create / Edit form ── */}
      <div className="bg-dcard rounded-lg border border-dline p-5 mb-6">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-dline">
          <Database className="w-5 h-5 text-cyan" />
          <h2 className="text-lg font-display font-semibold text-surface">
            {editingId ? `Edit: ${form.name}` : 'Buat Provider Baru'}
          </h2>
          {editingId && (
            <span className="text-xs text-slate-400 font-mono">(apiKey kosong = simpan key lama)</span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={f('name')}
              placeholder="e.g. Groq Production"
              className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Format</label>
            <select value={form.format} onChange={f('format')} className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan">
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Base URL</label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={f('baseUrl')}
              placeholder="https://api.groq.com/openai/v1/chat/completions"
              className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">API Key (password)</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={f('apiKey')}
              placeholder={editingId ? 'kosongkan untuk simpan key lama' : 'sk-...'}
              className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface font-mono focus:outline-none focus:ring-2 focus:ring-cyan"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Model</label>
            <input
              type="text"
              value={form.model}
              onChange={f('model')}
              placeholder="e.g. gpt-4o, gemini-2.0-flash"
              className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Role</label>
            <select value={form.role} onChange={f('role')} className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan">
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-400 mb-1">Priority (higher = prefered)</label>
              <input
                type="number"
                min={0}
                value={form.priority}
                onChange={f('priority')}
                className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
              />
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <label className="text-xs text-slate-400">Active</label>
              <input type="checkbox" checked={form.isActive} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((s) => ({ ...s, isActive: e.target.checked }))} className="h-4 w-4 rounded bg-dcard border border-dline text-cyan focus:ring-cyan" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleTestDraft}
              disabled={testingDraft || !isSuperAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-300 border border-dline rounded-lg hover:bg-dline/20 disabled:opacity-50 transition font-mono"
            >
              {testingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              Test Draft
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isSuperAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-cyan border border-cyan/20 bg-cyan/5 rounded-lg hover:bg-cyan/10 disabled:opacity-50 transition font-mono"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {editingId ? 'Save' : 'Create'}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-sm font-medium text-slate-400 border border-dline rounded-lg hover:bg-dline/20 transition"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Draft test-connection result (persistent until a new test) */}
        {formTestResult && (
          <div className="mt-4 p-3 rounded-lg border border-dline text-sm">
            {formTestResult.success ? (
              <div className="flex items-start gap-2 text-cyan">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Koneksi OK — {formTestResult.modelUsed} ({formTestResult.latencyMs}ms)</p>
                  {formTestResult.sampleResponse && <p className="font-mono text-xs">sample: {formTestResult.sampleResponse}</p>}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-red-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Gagal: {formTestResult.errorCategory} {formTestResult.statusCode ? `(${formTestResult.statusCode})` : ''}</p>
                  <p className="font-mono text-xs break-all">{formTestResult.errorMessage}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Provider table ── */}
      <div className="bg-dcard rounded-lg border border-dline overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dline">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Format</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Role</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Model</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">API Key</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Priority</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-slate-400">Active</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Last Test</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dline">
            {providers.map((r) => (
              <tr key={r.id} className="hover:bg-dline/10">
                <td className="px-4 py-3 text-surface font-mono text-xs">{r.name}</td>
                <td className="px-4 py-3 text-slate-300">{r.format}</td>
                <td className="px-4 py-3 text-slate-300 font-mono">{r.role}</td>
                <td className="px-4 py-3 text-slate-300 font-mono">{r.model}</td>
                <td className="px-4 py-3 text-slate-300 font-mono">{r.apiKey ?? 'null'}</td>
                <td className="px-4 py-3 text-right text-slate-300">{r.priority}</td>
                <td className="px-4 py-3 text-center">{r.isActive ? <Power className="w-3.5 h-3.5 text-cyan mx-auto" /> : <span className="text-xs text-slate-500">off</span>}</td>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs max-w-xs truncate">
                  {r.lastTestResult ? (
                    <span className={r.lastTestResult === 'ok' ? 'text-cyan' : 'text-red-400'}>
                      {new Date(r.lastTestedAt ?? r.updatedAt).toLocaleString('id-ID')} — {r.lastTestResult}
                    </span>
                  ) : (
                    <span className="text-slate-500">never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => handleTestRow(r)}
                      disabled={!isSuperAdmin}
                      className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                      title="Test connection"
                    >
                      <Wifi className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => startEdit(r)}
                      disabled={!isSuperAdmin}
                      className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(r)}
                      disabled={!isSuperAdmin}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-50"
                      title="Hapus"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {providers.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                  Belum ada provider. Buat yang pertama di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Inline, persistent per-row test-connection result (not a disappearing toast) */}
      {Object.keys(testResults).map((id) => {
        const r = testResults[id];
        const row = providers.find((p) => p.id === id);
        if (!row) return null;
        return (
          <div key={id} className="mt-3 p-3 rounded-lg border border-dline bg-dline/10 text-sm">
            <div className="flex items-start gap-2">
              {r.success ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-cyan shrink-0" />
              ) : r.errorCategory ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
              ) : (
                <RefreshCw className="w-4 h-4 mt-0.5 animate-spin text-slate-400 shrink-0" />
              )}
              <div className="flex-1">
                <p className="font-medium text-surface">
                  {row.name} — {r.success ? `OK (${r.latencyMs}ms, ${r.modelUsed})` : `${r.errorCategory ?? '...'}${r.statusCode ? ' (' + r.statusCode + ')' : ''}`}
                </p>
                {!r.success && r.errorMessage && (
                  <p className="font-mono text-xs text-red-300 break-all mt-1">{r.errorMessage}</p>
                )}
              </div>
              <button
                onClick={() => dismissRowTest(id)}
                className="ml-2 text-slate-400 hover:text-surface p-1 rounded hover:bg-dline/20"
                title="Dismiss"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
