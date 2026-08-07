import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Edit3, ArrowLeft, Save, X, Loader2, MessageSquare } from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  keywords: string[];
  priority: number;
  matchCount: number;
  createdAt: string;
}

export default function FaqManager() {
  const navigate = useNavigate();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmQuestion, setDeleteConfirmQuestion] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [form, setForm] = useState({ question: '', answer: '', category: '', keywords: '', priority: 1 });

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadFaqs = useCallback(() => {
    setLoading(true);
    api.get('/faq', { params: { search: search || undefined } })
      .then((res) => setFaqs(res.data.data))
      .catch(() => showFeedback('error', 'Gagal memuat daftar FAQ'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    loadFaqs();
  }, [loadFaqs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback(null);

    const payload = {
      ...form,
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    };

    try {
      if (editId) {
        await api.put(`/faq/${editId}`, payload);
        showFeedback('success', 'FAQ berhasil diperbarui');
      } else {
        await api.post('/faq', payload);
        showFeedback('success', 'FAQ berhasil disimpan');
      }
      setShowForm(false);
      setEditId(null);
      setForm({ question: '', answer: '', category: '', keywords: '', priority: 1 });
      loadFaqs();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal menyimpan FAQ';
      showFeedback('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (faq: FAQ) => {
    setForm({
      question: faq.question,
      answer: faq.answer,
      category: faq.category || '',
      keywords: faq.keywords.join(', '),
      priority: faq.priority,
    });
    setEditId(faq.id);
    setShowForm(true);
  };

const handleDelete = (id: string, question: string) => {
    setDeleteConfirmId(id);
    setDeleteConfirmQuestion(question);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleting(deleteConfirmId);
    setFeedback(null);
    try {
      await api.delete(`/faq/${deleteConfirmId}`);
      showFeedback('success', 'FAQ berhasil dihapus');
      loadFaqs();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal menghapus FAQ';
      showFeedback('error', msg);
    } finally {
      setDeleting(null);
      setDeleteConfirmId(null);
      setDeleteConfirmQuestion('');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm({ question: '', answer: '', category: '', keywords: '', priority: 1 });
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-muted hover:text-ink focus-visible:ring-2 focus:ring-brand rounded transition shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-ink">FAQ Manager</h1>
            <p className="text-sm text-muted">Manage automated question & answer pairs</p>
          </div>
        </div>
        <button
          onClick={() => { setEditId(null); setForm({ question: '', answer: '', category: '', keywords: '', priority: 1 }); setShowForm(true); }}
          className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Add FAQ
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

      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search FAQs..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Question</label>
              <input type="text" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand" required disabled={saving} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Answer</label>
              <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand h-24" required disabled={saving} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Category</label>
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-ink mb-1.5">Keywords (comma separated)</label>
              <input type="text" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Prioritas</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full px-3 py-2 border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-2 focus:ring-brand" disabled={saving}>
                <option value={1}>Utama</option>
                <option value={2}>Biasa</option>
              </select>
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

      {/* FAQ List */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-5">
<div className="h-5 w-3/4 rounded bg-line animate-pulse mb-3" />
              <div className="h-4 w-full rounded bg-line animate-pulse mb-2" />
              <div className="h-3 w-1/3 rounded bg-line animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {faqs.map((faq) => (
            <div key={faq.id} className="bg-surface dark:bg-dcard rounded-xl border-line dark:border-dline p-5 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-4 h-4 text-brand shrink-0" />
                    <h3 className="font-medium text-ink truncate">{faq.question}</h3>
                    {faq.priority === 1 && (
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">Prioritas: Utama</span>
                    )}
                  </div>
                  <p className="text-sm text-muted line-clamp-2 mb-2">{faq.answer}</p>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    {faq.category && <span className="bg-line px-2 py-0.5 rounded font-medium">{faq.category}</span>}
<span>Answered: {faq.matchCount}x</span>
                    {faq.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {faq.keywords.slice(0, 3).map((kw, i) => (
                          <span key={i} className="text-xs bg-line text-muted px-2 py-0.5 rounded-full">{kw}</span>
                        ))}
                        {faq.keywords.length > 3 && (
                          <span className="text-xs bg-line text-muted px-2 py-0.5 rounded-full">+{faq.keywords.length - 3} lagi</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 ml-4 shrink-0">
                  <button onClick={() => handleEdit(faq)} disabled={deleting === faq.id}
                    className="p-2 text-muted hover:bg-brand-soft dark:hover:bg-brand/15 rounded-lg transition disabled:opacity-50">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(faq.id, faq.question)} disabled={deleting === faq.id}
                    className="p-2 text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50">
                    {deleting === faq.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {faqs.length === 0 && (
            <div className="text-center py-16">
              <MessageSquare className="w-10 h-10 text-muted mx-auto mb-3" />
              <p className="text-muted">No FAQs yet. Add your first FAQ to get started.</p>
            </div>
          )}
</div>
      )}

    {deleteConfirmId && (
      <ConfirmDialog
        title="Hapus FAQ"
        message={`Hapus FAQ "${deleteConfirmQuestion}"?`}
        consequence="FAQ akan dihapus permanen dan tidak dapat dikembalikan."
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteConfirmId(null);
          setDeleteConfirmQuestion('');
        }}
      />
    )}
  </div>
  );
}
