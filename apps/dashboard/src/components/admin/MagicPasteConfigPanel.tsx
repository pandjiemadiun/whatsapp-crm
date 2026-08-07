import { useState, useEffect } from 'react';
import ConfirmDialog from '../ConfirmDialog';
import { Database, Edit, Trash2, Save, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import magicPasteService from '../../services/magicPasteService';
import type { MagicPastePattern, MagicPasteSettings } from '../../types/magicPaste';

interface Props {
  token: string;
}

interface PatternForm {
  name: string;
  description: string;
  regex: string;
  confidence: number;
  isActive: boolean;
  sortOrder: number;
  fieldMappings: Array<{ field: string; group: number }>;
}

const EMPTY_FORM: PatternForm = {
  name: '',
  description: '',
  regex: '',
  confidence: 0.7,
  isActive: true,
  sortOrder: 100,
  fieldMappings: [
    { field: 'name', group: 1 },
    { field: 'price', group: 2 },
    { field: 'stock', group: 3 },
  ],
};

/**
 * Panel kelola Pattern Library + Settings Magic Paste.
 * Tab: Pattern Library | Settings
 */
export function MagicPasteConfigPanel({ token }: Props) {
  const [patterns, setPatterns] = useState<MagicPastePattern[]>([]);
  const [settings, setSettings] = useState<MagicPasteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PatternForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'patterns' | 'settings'>('patterns');
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await magicPasteService.getConfig(token);
      if (!res.success || !res.data) {
        setError(res.error || 'Gagal memuat konfigurasi');
        return;
      }
      setPatterns(res.data.patterns);
      setSettings(res.data.settings);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ─── Pattern handlers ───

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (p: MagicPastePattern) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description,
      regex: p.regex,
      confidence: p.confidence,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      fieldMappings: p.fieldMappings?.length ? p.fieldMappings : [{ field: 'name', group: 1 }, { field: 'price', group: 2 }],
    });
    setExpandedPatternId(p.id);
  };

  const cancelEdit = () => {
    resetForm();
  };

  const savePattern = async () => {
    // Validasi regex
    try {
      new RegExp(form.regex, 'gi');
    } catch {
      setError('Regex tidak valid');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const res = await magicPasteService.updatePattern(token, editingId, form);
        if (!res.success) { setError(res.error || 'Gagal update pattern'); return; }
        setPatterns(patterns.map((p) => (p.id === editingId ? { ...res.data!, id: editingId } : p)));
      } else {
        const res = await magicPasteService.createPattern(token, form);
        if (!res.success) { setError(res.error || 'Gagal buat pattern'); return; }
        setPatterns([...patterns, res.data!]);
      }
      resetForm();
      loadConfig();
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const deletePattern = (id: string, name: string) => {
    setDeleteConfirm({ id, name });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id, name } = deleteConfirm;
    setDeleteConfirm(null);
    setSaving(true);
    try {
      const res = await magicPasteService.deletePattern(token, id);
      if (!res.success) { setError(res.error || 'Gagal hapus pattern'); return; }
      setPatterns(patterns.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Settings handlers ───

  const updateSettings = async (updates: Partial<MagicPasteSettings>) => {
    if (!settings) return;
    const updated = { ...settings, ...updates };
    setSettings(updated);
    setSaving(true);
    try {
      const res = await magicPasteService.updateSettings(token, updated);
      if (!res.success) {
        setError(res.error || 'Gagal update settings');
        loadConfig();
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-slate-500">
        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
        Memuat konfigurasi...
      </div>
    );
  }

  return (
    <>
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-indigo-100 p-2.5 text-indigo-600">
          <Database className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Konfigurasi Magic Paste</h1>
          <p className="text-sm text-slate-500">Kelola pattern library &amp; pengaturan ekstraksi</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg text-sm font-medium">
        <button
          onClick={() => setActiveTab('patterns')}
          className={`flex-1 py-2 rounded-md transition ${
            activeTab === 'patterns' ? 'bg-white text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pattern Library
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-2 rounded-md transition ${
            activeTab === 'settings' ? 'bg-white text-indigo-600 shadow' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pengaturan
        </button>
      </div>

      {/* ─── TAB: Pattern Library ─── */}
      {activeTab === 'patterns' && (
        <>
          {/* Add/Edit Form */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">
              {editingId ? 'Edit Pattern' : 'Tambah Pattern Baru'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nama pattern (mis. Nama Harga Stok)"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                type="number"
                min={0}
                placeholder="Urutan"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <input
              value={form.regex}
              onChange={(e) => setForm({ ...form, regex: e.target.value })}
              placeholder="Regex pattern (mis. (.+?)\\s+(\\d[\\d.,]*)\\s*(?:stok\\s*(\\d+))?)..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Deskripsi"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tingkat Cocok</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.confidence}
                  onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Active</label>
                <select
                  value={form.isActive ? 'yes' : 'no'}
                  onChange={(e) => setForm({ ...form, isActive: e.target.value === 'yes' })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="yes">Ya</option>
                  <option value="no">Tidak</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={savePattern}
                  disabled={saving || !form.name || !form.regex}
                  className="flex-1 flex items-center justify-center gap-1 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300 transition"
                >
                  {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  {editingId ? 'Update' : 'Buat'}
                </button>
                {editingId && (
                  <button
                    onClick={cancelEdit}
                    className="flex-1 flex items-center justify-center gap-1 border border-slate-200 text-slate-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition"
                  >
                    <Edit className="w-3 h-3" /> Batal
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Pattern List */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Daftar Pattern ({patterns.length})</h2>
            {patterns.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center border border-slate-200 rounded-lg bg-slate-50">
                Belum ada pattern. Tambahkan di atas.
              </p>
            ) : (
              patterns.map((p) => (
                <div key={p.id} className="border border-slate-200 rounded-lg bg-white">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => setExpandedPatternId(expandedPatternId === p.id ? null : p.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        p.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
                      }`}>
                        {p.isActive ? 'Aktif' : 'Non-aktif'}
                      </span>
                      <span className="text-sm font-medium text-slate-900">{p.name}</span>
                      <span className="text-xs text-slate-500">confidence {Math.round(p.confidence * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePattern(p.id, p.name); }}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {expandedPatternId === p.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>
                  {expandedPatternId === p.id && (
                    <div className="px-3 pb-3 border-t border-slate-100 space-y-1">
                      <p className="text-xs text-slate-600">{p.description || 'Tanpa deskripsi'}</p>
                      <code className="block text-xs bg-slate-50 px-2 py-1 rounded font-mono text-slate-700 break-all">{p.regex}</code>
                      <div className="flex gap-2 pt-1">
                        {p.fieldMappings?.map((fm, i) => (
                          <span key={i} className="text-xs text-slate-600">
                            group {fm.group} → {fm.field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ─── TAB: Settings ─── */}
      {activeTab === 'settings' && settings && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Pengaturan Magic Paste</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Ambang Tingkat Cocok (regex-first)
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={settings.regexFirstThreshold}
                onChange={(e) => updateSettings({ regexFirstThreshold: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Jika regex confidence ≥ nilai ini, LLM tidak dipanggil. Default: 0.7
              </p>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 w-full">
                <input
                  type="checkbox"
                  checked={settings.llmEnabled}
                  onChange={(e) => updateSettings({ llmEnabled: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Gunakan LLM sebagai fallback</span>
              </label>
            </div>
          </div>

          {saving && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Menyimpan...
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
            <span>Total pattern aktif: {patterns.filter((p) => p.isActive).length} dari {patterns.length}</span>
            <button
              onClick={loadConfig}
              className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        </div>
      )}
    </div>

    {deleteConfirm && (
      <ConfirmDialog
        title="Hapus Pattern"
        message={`Hapus pattern "${deleteConfirm.name}"?`}
        consequence="Pattern akan dihapus permanen dan tidak dapat dikembalikan."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    )}
    </>
  );
}
