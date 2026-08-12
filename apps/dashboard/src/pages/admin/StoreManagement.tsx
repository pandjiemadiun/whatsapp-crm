import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Search, ArrowLeft, Loader2, X, CheckCircle, XCircle,
  Smartphone, Mail, Key, MessageSquare, ShoppingCart, DollarSign, Activity, Brain,
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface StoreSummary {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  isActive: boolean;
  isSuspended: boolean;
  isEmailVerified: boolean;
  fonnteConnected: boolean;
  createdAt: string;
}

interface PaginationInfo {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface StoreDetail {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  isActive: boolean;
  isSuspended: boolean;
  isEmailVerified: boolean;
  createdAt: string;
  stats: {
    totalConversations: number;
    totalMessages: number;
    totalOrders: number;
    aiResponseCount: number;
    totalCostUSD: string;
  };
  fonnteStatus: { connected: boolean; phoneNumber: string | null };
  subscriptionStatus: string;
}

export default function StoreManagement() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [, setConfirmDialog] = useState<{ action: 'reset_password' | 'verify_email' | 'disconnect_fonnte'; storeId: string; message: string } | null>(null);

  // Detail modal
  const [detailStore, setDetailStore] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{ storeId: string; action: 'suspend' | 'activate'; reason?: string } | null>(null);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadStores = useCallback(() => {
    setLoading(true);
    adminApi.get('/stores', { params: { page, search: search || undefined } })
      .then((res) => {
        setStores(res.data.data.stores);
        setPagination({
          total: res.data.data.total,
          page: res.data.data.page,
          pageSize: res.data.data.pageSize,
          totalPages: res.data.data.totalPages,
        });
      })
      .catch(() => showFeedback('error', 'Gagal memuat daftar toko'))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const loadDetail = async (storeId: string) => {
    setDetailLoading(true);
    try {
      const res = await adminApi.get(`/stores/${storeId}`);
      setDetailStore(res.data.data);
    } catch {
      showFeedback('error', 'Gagal memuat detail toko');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAction = async (storeId: string, action: 'suspend' | 'activate') => {
    setActionLoading(storeId);
    setConfirmAction(null);
    try {
      if (action === 'suspend') {
        await adminApi.put(`/stores/${storeId}/suspend`, { reason: confirmAction?.reason || undefined });
      } else {
        await adminApi.put(`/stores/${storeId}/activate`);
      }
      showFeedback('success', `Toko berhasil ${action === 'suspend' ? 'disuspend' : 'diaktifkan'}`);
      loadStores();
      if (detailStore?.id === storeId) {
        loadDetail(storeId);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal memproses';
      showFeedback('error', msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = (storeId: string) => {
    setConfirmDialog({ action: 'reset_password', storeId, message: 'Reset password toko ini? Toko akan menerima email reset password.' });
  };

  const handleVerifyEmail = (storeId: string) => {
    setConfirmDialog({ action: 'verify_email', storeId, message: 'Verifikasi email toko ini?' });
  };

  const handleDisconnectFonnte = (storeId: string) => {
    setConfirmDialog({ action: 'disconnect_fonnte', storeId, message: 'Putuskan koneksi Fonnte toko ini?' });
  };

  return (
    <div className="p-6 text-surface">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-surface transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-xl text-surface">Store Management</h1>
          <p className="text-sm text-slate-400">Manage all stores on the platform</p>
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

      {/* Search */}
      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email..."
          className="w-full pl-10 pr-4 py-2 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="bg-dcard rounded-lg border border-dline p-4">
              <div className="h-5 w-1/3 rounded bg-dline animate-pulse mb-2" />
              <div className="h-4 w-1/4 rounded bg-dline/50 animate-pulse" />
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
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Store</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden md:table-cell">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden lg:table-cell">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 hidden sm:table-cell">Fonnte</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dline">
                  {stores.map((store) => (
                    <tr
                      key={store.id}
                      className="hover:bg-dline/10 transition cursor-pointer"
                      onClick={() => loadDetail(store.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-surface font-mono">{store.name}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-400 hidden md:table-cell text-xs font-mono">{store.email}</td>
                      <td className="px-4 py-3 text-slate-400 hidden lg:table-cell text-xs font-mono">{store.phoneNumber || '-'}</td>
                      <td className="px-4 py-3">
                        {store.isSuspended ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-red-400 bg-red-500/10">
                            <XCircle className="w-3 h-3" /> Suspended
                          </span>
                        ) : store.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-cyan bg-cyan/10">
                            <CheckCircle className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-slate-400 bg-dline/20">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {store.fonnteConnected ? (
                          <span className="text-cyan text-xs font-mono">Connected</span>
                        ) : (
                          <span className="text-slate-400 text-xs font-mono">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); loadDetail(store.id); }}
                          disabled={actionLoading === store.id}
                          className="text-cyan hover:text-cyan/80 text-xs font-mono disabled:opacity-50"
                        >
                          Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stores.length === 0 && (
                <div className="text-center py-16">
                  <Store className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400">No stores found.</p>
                </div>
              )}
            </div>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <p className="text-slate-400 font-mono">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} stores)
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
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-3 py-1.5 border border-dline rounded-lg text-slate-400 hover:bg-dline/20 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {(detailStore || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => !detailLoading && setDetailStore(null)}>
          <div className="bg-dcard border border-dline shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className="p-6 space-y-4">
                <div className="h-6 w-48 rounded bg-dline animate-pulse" />
                <div className="h-4 w-32 rounded bg-dline/50 animate-pulse" />
                <div className="grid grid-cols-2 gap-4 mt-4">
                  {[1,2,3,4].map((i) => <div key={i} className="h-20 rounded bg-dline/50 animate-pulse" />)}
                </div>
              </div>
            ) : detailStore && (
              <>
                {/* Modal header */}
                <div className="flex items-center justify-between p-6 border-b border-dline">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-surface">{detailStore.name}</h2>
                    <p className="text-sm text-slate-400">{detailStore.email}</p>
                  </div>
                  <button onClick={() => setDetailStore(null)} className="text-slate-400 hover:text-surface">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Status badges */}
                  <div className="flex flex-wrap gap-2">
                    {detailStore.isSuspended ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-red-400 bg-red-500/10">
                        <XCircle className="w-3.5 h-3.5" /> Suspended
                      </span>
                    ) : detailStore.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-cyan bg-cyan/10">
                        <CheckCircle className="w-3.5 h-3.5" /> Active
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${
                      detailStore.isEmailVerified
                        ? 'text-cyan bg-cyan/10'
                        : 'text-amber-400 bg-amber-400/10'
                    }`}>
                      <Mail className="w-3.5 h-3.5" />
                      {detailStore.isEmailVerified ? 'Email Verified' : 'Email Unverified'}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-slate-400 bg-dline/20">
                      <Smartphone className="w-3.5 h-3.5" /> Fonnte: {detailStore.fonnteStatus.connected ? 'Connected' : 'Disconnected'}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-slate-400 bg-dline/20">
                      <Activity className="w-3.5 h-3.5" /> Sub: <span className="font-mono">{detailStore.subscriptionStatus}</span>
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-400 mb-3">Store Stats</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="bg-dline/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <MessageSquare className="w-3.5 h-3.5" /> Conversations
                        </div>
                        <p className="text-lg font-mono font-bold text-surface">{detailStore.stats.totalConversations}</p>
                      </div>
                      <div className="bg-dline/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <MessageSquare className="w-3.5 h-3.5" /> Messages
                        </div>
                        <p className="text-lg font-mono font-bold text-surface">{detailStore.stats.totalMessages}</p>
                      </div>
                      <div className="bg-dline/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <ShoppingCart className="w-3.5 h-3.5" /> Orders
                        </div>
                        <p className="text-lg font-mono font-bold text-surface">{detailStore.stats.totalOrders}</p>
                      </div>
                      <div className="bg-dline/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <Brain className="w-3.5 h-3.5" /> AI Responses
                        </div>
                        <p className="text-lg font-mono font-bold text-surface">{detailStore.stats.aiResponseCount}</p>
                      </div>
                      <div className="bg-dline/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <DollarSign className="w-3.5 h-3.5" /> AI Cost (IDR)
                        </div>
                        <p className="text-lg font-mono font-bold text-surface">
                          Rp {parseFloat(detailStore.stats.totalCostUSD || '0').toLocaleString('id-ID')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-400 mb-3">Actions</h3>
                    <div className="flex flex-wrap gap-2">
                      {detailStore.isSuspended ? (
                        <button
                          onClick={() => handleAction(detailStore.id, 'activate')}
                          disabled={actionLoading === detailStore.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-cyan text-navy disabled:opacity-50 transition w-full sm:w-auto"
                        >
                          {actionLoading === detailStore.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Activate
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmAction({ storeId: detailStore.id, action: 'suspend' })}
                          disabled={actionLoading === detailStore.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition w-full sm:w-auto"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Suspend
                        </button>
                      )}
                      <button
                        onClick={() => handleResetPassword(detailStore.id)}
                        disabled={actionLoading === detailStore.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-dline text-surface hover:bg-dline/20 disabled:opacity-50 transition w-full sm:w-auto"
                      >
                        <Key className="w-3.5 h-3.5" /> Reset Password
                      </button>
                      {!detailStore.isEmailVerified && (
                        <button
                          onClick={() => handleVerifyEmail(detailStore.id)}
                          disabled={actionLoading === detailStore.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-dline text-surface hover:bg-dline/20 disabled:opacity-50 transition w-full sm:w-auto"
                        >
                          <Mail className="w-3.5 h-3.5" /> Verify Email
                        </button>
                      )}
                      <button
                        onClick={() => handleDisconnectFonnte(detailStore.id)}
                        disabled={actionLoading === detailStore.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-dline text-surface hover:bg-dline/20 disabled:opacity-50 transition w-full sm:w-auto"
                      >
                        <Smartphone className="w-3.5 h-3.5" /> Disconnect Fonnte
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Suspend Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setConfirmAction(null)}>
          <div className="bg-dcard border border-dline shadow-xl w-full max-w-md p-6 rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-surface">Confirm Suspend</h3>
                <p className="text-sm text-slate-400 mt-1">Are you sure you want to suspend this store?</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 border border-dline rounded-lg text-sm text-slate-400 hover:bg-dline/20 font-mono"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(confirmAction.storeId, 'suspend')}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-mono hover:bg-red-600"
              >
                Confirm Suspend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
