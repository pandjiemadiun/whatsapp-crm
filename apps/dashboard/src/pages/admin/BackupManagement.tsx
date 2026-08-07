import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive, ArrowLeft, Loader2, Trash2, RefreshCw, CheckCircle, AlertTriangle, Upload, FileText, AlertCircle, Download,
} from 'lucide-react';
import adminApi from '../../services/adminApi';
import { useAdminAuth } from '../../contexts/AdminAuthContext';

interface BackupEntry {
  filename: string;
  size: number;
  createdAt: string;
  checksum: string;
  verifiedAt: string | null;
  restoredAt: string | null;
}

interface BackupStats {
  total: number;
  totalSize: number;
  oldest: string | null;
  newest: string | null;
}

export default function BackupManagement() {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const isSuperAdmin = admin?.role === 'super_admin';

  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  // Restore dialog
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadBackups = () => {
    setLoading(true);
    adminApi.get('/backups')
      .then((res) => {
        setBackups(res.data.data.backups || []);
        setStats(res.data.data.stats || null);
      })
      .catch(() => showFeedback('error', 'Gagal memuat data backup'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await adminApi.post('/backups');
      showFeedback('success', 'Backup manual berhasil dipicu');
      loadBackups();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal trigger backup';
      showFeedback('error', msg);
    } finally {
      setTriggering(false);
    }
  };

  const handleVerify = async (filename: string) => {
    setActionLoading(filename);
    try {
      const res = await adminApi.get(`/backups/${filename}/verify`);
      showFeedback('success', res.data.data?.valid ? 'Backup valid (checksum cocok)' : 'Backup rusak (checksum tidak cocok)');
      loadBackups();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal verifikasi backup');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setActionLoading(restoreTarget);
    setRestoreTarget(null);
    setRestoreConfirmText('');
    try {
      await adminApi.post(`/backups/${restoreTarget}/restore`);
      showFeedback('success', 'Restore berhasil dijalankan');
      loadBackups();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal restore backup');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget);
    setDeleteTarget(null);
    try {
      await adminApi.delete(`/backups/${deleteTarget}`);
      showFeedback('success', 'Backup berhasil dihapus');
      loadBackups();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal hapus backup');
    } finally {
      setActionLoading(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (loading) {
    return (
      <div className="p-6 text-surface">
        <div className="flex items-center gap-3 mb-6">
          <Archive className="w-5 h-5 text-cyan" />
          <div>
            <h1 className="font-display text-xl text-surface">Backup Management</h1>
            <p className="text-sm text-slate-400">Database backup & recovery</p>
          </div>
        </div>
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="bg-dcard rounded-lg border border-dline p-5">
              <div className="h-5 w-1/2 rounded bg-dline animate-pulse mb-3" />
              <div className="h-4 w-1/3 rounded bg-dline/50 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-surface">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">Backup Management</h1>
          <p className="text-sm text-slate-400">Database backup & recovery</p>
        </div>
      </div>

      {feedback && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-cyan/10 text-cyan border border-cyan/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
        </div>
      )}

      {/* Stats + Trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-dcard rounded-lg border border-dline p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Backup Stats</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">Total Backups</p>
              <p className="text-lg font-mono font-bold text-surface">{stats?.total || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total Size</p>
              <p className="text-lg font-mono font-bold text-surface">{stats ? formatSize(stats.totalSize) : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Oldest</p>
              <p className="text-sm font-mono text-slate-300">{stats?.oldest ? new Date(stats.oldest).toLocaleString('id-ID') : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Newest</p>
              <p className="text-sm font-mono text-slate-300">{stats?.newest ? new Date(stats.newest).toLocaleString('id-ID') : '-'}</p>
            </div>
          </div>
        </div>
        <div className="bg-dcard rounded-lg border border-dline p-5 flex flex-col justify-center items-center">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="bg-brand text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-brand-deep disabled:opacity-50 transition flex items-center gap-2 font-mono w-full sm:w-auto"
          >
            {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {triggering ? 'Triggering...' : 'Trigger Backup Manual'}
          </button>
        </div>
      </div>

      {/* Backup List */}
      <div className="bg-dcard rounded-lg border border-dline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dline">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Filename</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden md:table-cell">Size</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden lg:table-cell">Created</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dline">
              {backups.map((backup) => (
                <tr key={backup.filename} className="hover:bg-dline/10">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="text-sm text-surface font-mono text-xs">{backup.filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs hidden md:table-cell font-mono">{formatSize(backup.size)}</td>
                  <td className="px-4 py-3">
                    {backup.verifiedAt ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-cyan bg-cyan/10">
                        <CheckCircle className="w-3 h-3" /> Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-slate-400 bg-dline/20">
                        <AlertCircle className="w-3 h-3" /> Unverified
                      </span>
                    )}
                    {backup.restoredAt && (
                      <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-brand bg-brand/10">
                        <Download className="w-3 h-3" /> Restored
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 hidden lg:table-cell font-mono">
                    {new Date(backup.createdAt).toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleVerify(backup.filename)}
                        disabled={actionLoading === backup.filename}
                        className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                        title="Verify checksum"
                      >
                        {actionLoading === backup.filename ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      </button>
                      {isSuperAdmin && (
                        <>
                          <button
                            onClick={() => { setRestoreTarget(backup.filename); setRestoreConfirmText(''); }}
                            disabled={actionLoading === backup.filename}
                            className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                            title="Restore"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(backup.filename)}
                            disabled={actionLoading === backup.filename}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {backups.length === 0 && (
            <div className="text-center py-16">
              <Archive className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">No backups yet. Trigger a manual backup to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* Restore Confirm Dialog (2-step) */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setRestoreTarget(null)}>
          <div className="bg-dcard border border-dline shadow-xl w-full max-w-md p-6 rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-surface">⚠️ Restore Backup — Operasi Destruktif</h3>
                <p className="text-sm text-slate-300 mt-1">
                  Restore akan mengganti seluruh database dengan data dari backup ini. Tindakan ini tidak bisa dibatalkan.
                </p>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-sm text-slate-300 mb-2">
                Ketik <strong className="font-mono text-red-400">{restoreTarget}</strong> untuk konfirmasi:
              </p>
              <input
                type="text"
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="Ketik nama file backup..."
                className="w-full px-3 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRestoreTarget(null)}
                className="px-4 py-2 border border-dline rounded-lg text-sm text-slate-300 hover:bg-dline/20 font-mono"
              >
                Cancel
              </button>
              <button
                onClick={handleRestore}
                disabled={restoreConfirmText !== restoreTarget}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-mono hover:bg-red-600 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" /> Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="bg-dcard border border-dline shadow-xl w-full max-w-md p-6 rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-surface">Hapus Backup</h3>
                <p className="text-sm text-slate-300">Hapus file backup ini secara permanen?</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-dline rounded-lg text-sm text-slate-300 hover:bg-dline/20 font-mono"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 flex items-center gap-2 font-mono"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
