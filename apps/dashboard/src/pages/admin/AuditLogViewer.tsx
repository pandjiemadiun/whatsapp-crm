import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, ArrowLeft, Filter, Users, Activity, Clock, User,
  FileDown, X, Download,
} from 'lucide-react';
import adminApi from '../../services/adminApi';
import ConfirmDialog from '../../components/ConfirmDialog';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  changes: Record<string, any> | null;
  ipAddress: string;
  createdAt: string;
}

interface AuditDetail {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  storeId: string | null;
  userId: string | null;
  adminId: string | null;
  ipAddress: string | null;
  changes: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditStats {
  totalActions: number;
  actionBreakdown: Record<string, number>;
  lastActionAt: string | null;
  topUsers: { userId: string; count: number }[];
}

export default function AuditLogViewer() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [detailLog, setDetailLog] = useState<AuditDetail | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportConfirm, setExportConfirm] = useState<'csv' | 'json' | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    const params: any = { page };
    if (filterAction) params.action = filterAction;

    Promise.all([
      adminApi.get('/audit-logs', { params }),
      adminApi.get('/audit-logs/stats'),
    ])
      .then(([listRes, statsRes]) => {
        setEntries(listRes.data.data?.logs || []);
        setTotalPages(listRes.data.data?.totalPages || 1);
        setStats(statsRes.data.data || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, filterAction]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = async (format: 'json' | 'csv') => {
    setExportLoading(true);
    try {
      const filters = filterAction ? { action: filterAction } : {};
      const res = await adminApi.post('/audit-logs/export', { format, filters }, { responseType: 'blob' });
      const blob = new Blob([res.data], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `audit-logs-${dateStr}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Gagal export logs');
    } finally {
      setExportLoading(false);
    }
  };

  const loadDetail = async (logId: string) => {
    try {
      const res = await adminApi.get(`/audit-logs/${logId}`);
      setDetailLog(res.data.data || null);
    } catch {
      setDetailLog(null);
    }
  };

  const actionColors: Record<string, string> = {
    CREATE: 'text-cyan bg-cyan/10',
    UPDATE: 'text-brand bg-brand/10',
    DELETE: 'text-red-400 bg-red-500/10',
    LOGIN: 'text-amber-400 bg-amber-400/10',
    LOGOUT: 'text-slate-400 bg-dline/20',
    SUSPEND: 'text-red-400 bg-red-500/10',
    ACTIVATE: 'text-cyan bg-cyan/10',
  };

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="p-6 text-surface">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">Audit Log</h1>
          <p className="text-sm text-slate-400">Track all administrative actions</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-dcard rounded-lg border border-dline p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Activity className="w-3.5 h-3.5" /> Total Actions
            </div>
            <p className="text-2xl font-mono font-bold text-surface">{stats.totalActions}</p>
          </div>
          <div className="bg-dcard rounded-lg border border-dline p-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5" /> Last Action
            </div>
            <p className="text-sm font-mono text-slate-300">
              {stats.lastActionAt ? new Date(stats.lastActionAt).toLocaleString('id-ID') : '-'}
            </p>
          </div>
          <div className="bg-dcard rounded-lg border border-dline p-4 md:col-span-2">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
              <Users className="w-3.5 h-3.5" /> Top Users
            </div>
            <div className="flex flex-wrap gap-2">
              {stats.topUsers.slice(0, 5).map((u) => (
                <span key={u.userId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-dline/20 text-slate-300 font-mono">
                  <User className="w-3 h-3" />
                  {u.userId.substring(0, 8)} ({u.count})
                </span>
              ))}
              {stats.topUsers.length === 0 && <span className="text-xs text-slate-400">No data</span>}
            </div>
          </div>
        </div>
      )}

      {/* Filter + Export */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono appearance-none"
          >
            <option value="">All Actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="SUSPEND">SUSPEND</option>
            <option value="ACTIVATE">ACTIVATE</option>
          </select>
        </div>
        <button
          onClick={() => setExportConfirm('csv')}
          disabled={exportLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-300 border border-dline rounded-lg hover:bg-dline/20 disabled:opacity-50 transition font-mono w-full sm:w-auto"
          title="Export logs (OK = CSV, Cancel = JSON)"
        >
          {exportLoading ? <Download className="w-4 h-4 animate-bounce" /> : <FileDown className="w-4 h-4" />}
          Export
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="bg-dcard rounded-lg border border-dline p-4">
              <div className="h-4 w-3/4 rounded bg-dline animate-pulse mb-2" />
              <div className="h-3 w-1/2 rounded bg-dline/50 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="bg-dcard rounded-lg border border-dline overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dline">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Entity</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden md:table-cell">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden lg:table-cell">IP</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dline">
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      onClick={() => loadDetail(entry.id)}
                      className="hover:bg-dline/10 transition cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${actionColors[entry.action] || 'text-slate-400 bg-dline/20'}`}>
                          {formatAction(entry.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-surface font-medium text-xs">{entry.entity}</p>
                        <p className="text-xs text-slate-400 font-mono">{entry.entityId.substring(0, 12)}...</p>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs hidden md:table-cell font-mono">
                        {entry.userId.substring(0, 12)}...
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs hidden lg:table-cell font-mono">
                        {entry.ipAddress}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400 font-mono">
                        {new Date(entry.createdAt).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entries.length === 0 && (
                <div className="text-center py-16">
                  <ClipboardList className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400">No audit log entries found.</p>
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <p className="text-slate-400 font-mono">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 border border-dline rounded-lg text-slate-400 hover:bg-dline/20 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 border border-dline rounded-lg text-slate-400 hover:bg-dline/20 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Detail Modal ─── */}
      {detailLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-dcard shadow-xl border border-dline max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dline">
              <h2 className="font-display font-semibold text-surface">Audit Log Detail</h2>
              <button
                onClick={() => setDetailLog(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-dline/20 transition"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400">Action:</span>
                  <span className={`ml-2 font-medium ${actionColors[detailLog.action] || 'text-slate-300'}`}>
                    {formatAction(detailLog.action)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Entity:</span>
                  <span className="ml-2 text-surface">{detailLog.entity}</span>
                </div>
                <div>
                  <span className="text-slate-400">Entity ID:</span>
                  <span className="ml-2 font-mono text-xs text-slate-300 break-all">{detailLog.entityId}</span>
                </div>
                <div>
                  <span className="text-slate-400">Store ID:</span>
                  <span className="ml-2 font-mono text-xs text-slate-300">{detailLog.storeId || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400">User ID:</span>
                  <span className="ml-2 font-mono text-xs text-slate-300">{detailLog.userId || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400">Admin ID:</span>
                  <span className="ml-2 font-mono text-xs text-slate-300">{detailLog.adminId || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400">IP Address:</span>
                  <span className="ml-2 text-slate-300">{detailLog.ipAddress || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400">Created:</span>
                  <span className="ml-2 text-slate-300">{new Date(detailLog.createdAt).toLocaleString('id-ID')}</span>
                </div>
              </div>
              {detailLog.changes && (
                <div>
                  <span className="text-slate-400 block mb-1">Changes:</span>
                  <pre className="bg-dline/20 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto text-slate-300">
                    {JSON.stringify(detailLog.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-dline bg-dline/20 rounded-b-xl">
              <button
                onClick={() => setDetailLog(null)}
                className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-dline/30 rounded-lg transition font-mono"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
