import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Edit3, ArrowLeft, Save, X, FileText, Loader2 } from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface Knowledge {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  source: string | null;
  relevanceScore: number;
  createdAt: string;
}

export default function KnowledgeManager() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Knowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [form, setForm] = useState({ title: '', content: '', category: '', tags: '', source: '', relevanceScore: 0 });

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadEntries = useCallback(() => {
    setLoading(true);
    api.get('/knowledge', { params: { search: search || undefined } })
      .then((res) => setEntries(res.data.data))
      .catch(() => showFeedback('error', 'Gagal memuat daftar knowledge'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback(null);

    const payload = {
      ...form,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      relevanceScore: Number(form.relevanceScore) || 0,
    };

    try {
      if (editId) {
        await api.put(`/knowledge/${editId}`, payload);
        showFeedback('success', 'Knowledge berhasil diperbarui');
      } else {
        await api.post('/knowledge', payload);
        showFeedback('success', 'Knowledge berhasil disimpan');
      }
      setShowForm(false);
      setEditId(null);
      setForm({ title: '', content: '', category: '', tags: '', source: '', relevanceScore: 0 });
      loadEntries();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal menyimpan knowledge';
      showFeedback('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (entry: Knowledge) => {
    setForm({
      title: entry.title,
      content: entry.content,
      category: entry.category || '',
      tags: entry.tags.join(', '),
      source: entry.source || '',
      relevanceScore: entry.relevanceScore,
    });
    setEditId(entry.id);
    setShowForm(true);
  };

const handleDelete = (id: string, title: string) => {
    setDeleteConfirmId(id);
    setDeleteConfirmTitle(title);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleting(deleteConfirmId);
    setFeedback(null);
    try {
      await api.delete(`/knowledge/${deleteConfirmId}`);
      showFeedback('success', 'Knowledge berhasil dihapus');
      loadEntries();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal menghapus knowledge';
      showFeedback('error', msg);
    } finally {
      setDeleting(null);
      setDeleteConfirmId(null);
      setDeleteConfirmTitle('');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm({ title: '', content: '', category: '', tags: '', source: '', relevanceScore: 0 });
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-muted hover:text-ink focus-visible:ring-2 focus:ring-brand rounded transition shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-ink">Knowledge Base</h1>
            <p className="text-sm text-muted">Manage reference documents for your store</p>
          </div>
        </div>
        <button
          onClick={() => { setEditId(null); setForm({ title: '', content: '', category: '', tags: '', source: '', relevanceScore: 0 }); setShowForm(true); }}
          className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Entry
        </button>
      </div>

      {feedback && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
        </div>
      )}

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search knowledge base..."
            className="w-full pl-10 pr-4 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <button
          onClick={() => { setEditId(null); setForm({ title: '', content: '', category: '', tags: '', source: '', relevanceScore: 0 }); setShowForm(true); }}
          className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Entry
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Title</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand" required disabled={saving} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Content</label>
              <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand h-32" required disabled={saving} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Category</label>
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Asal</label>
              <input type="text" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Tags (comma separated)</label>
              <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving} />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : (editId ? 'Update' : 'Save')}
            </button>
            <button type="button" onClick={resetForm} disabled={saving}
              className="flex items-center gap-2 bg-surface dark:bg-dcard text-ink dark:text-surface px-4 py-2 rounded-lg text-sm font-medium border-line dark:border-dline hover:bg-surface dark:hover:bg-dline disabled:opacity-50 focus-visible:ring-2 focus:ring-brand transition shrink-0 w-full sm:w-auto">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-5">
<div className="h-5 w-2/3 rounded bg-line animate-pulse mb-3" />
              <div className="h-4 w-full rounded bg-line animate-pulse mb-2" />
              <div className="h-3 w-1/4 rounded bg-line animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-5 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-brand shrink-0" />
                    <h3 className="font-medium text-ink truncate">{entry.title}</h3>
                  </div>
                  <p className="text-sm text-muted line-clamp-2 mb-2">{entry.content}</p>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    {entry.category && <span className="bg-line px-2 py-0.5 rounded font-medium">{entry.category}</span>}
{entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {entry.tags.slice(0, 3).map((tag, i) => (
                          <span key={i} className="text-xs bg-line text-muted px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                        {entry.tags.length > 3 && (
                          <span className="text-xs bg-line text-muted px-2 py-0.5 rounded-full">+{entry.tags.length - 3} lagi</span>
                        )}
                      </div>
                    )}
                    {entry.source && <span>Asal: {entry.source}</span>}
                  </div>
                </div>
                <div className="flex gap-1 ml-4 shrink-0">
                  <button onClick={() => handleEdit(entry)} disabled={deleting === entry.id}
                    className="p-2 text-muted hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(entry.id, entry.title)} disabled={deleting === entry.id}
                    className="p-2 text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50">
                    {deleting === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="text-center py-16">
<FileText className="w-10 h-10 text-muted mx-auto mb-3" />
              <p className="text-muted">No knowledge entries yet. Add your first entry.</p>
            </div>
          )}
</div>
      )}

    {deleteConfirmId && (
      <ConfirmDialog
        title="Hapus Knowledge"
        message={`Hapus knowledge "${deleteConfirmTitle}"?`}
        consequence="Knowledge akan dihapus permanen."
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteConfirmId(null);
          setDeleteConfirmTitle('');
        }}
      />
    )}
  </div>
  );
}
