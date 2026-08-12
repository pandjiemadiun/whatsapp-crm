import { useEffect, useState, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, ArrowLeft, Loader2, Edit3, Save, X, Eye, EyeOff, AlertTriangle, Trash2, RefreshCw, Wifi, CheckCircle2, Key, Shield, Database, Info } from 'lucide-react';
import adminApi from '../../services/adminApi';
import { useAdminAuth } from '../../contexts/AdminAuthContext';

interface ConfigEntry {
  key: string;
  value: string;
  category: string;
  isSecret: boolean;
  description: string | null;
  updatedAt: string;
}

export default function PlatformConfig() {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const isSuperAdmin = admin?.role === 'super_admin';

  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [reloadLoading, setReloadLoading] = useState(false);

  // Key rotation state
  const [dryRunResult, setDryRunResult] = useState<null | {
    models: Record<string, { rowCount: number; encryptedFieldCount: number; fields: Record<string, number> }>;
    totalRows: number;
    totalEncryptedFields: number;
    currentSource: string;
  }>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [rotationStep, setRotationStep] = useState<'idle' | 'preview' | 'confirm' | 'executing' | 'done'>('idle');
  const [newKey, setNewKey] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [rotatingError, setRotatingError] = useState<string | null>(null);
  const [rotationResult, setRotationResult] = useState<null | { success: boolean; rowsReEncrypted: number; modelsAffected: string[] }>(null);
  const ROTATION_PHRASE = 'ROTATE ENCRYPTION KEY';

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    setLoading(true);
    adminApi.get('/config')
      .then((res) => setConfigs(res.data.data || []))
      .catch(() => showFeedback('error', 'Gagal memuat konfigurasi'))
      .finally(() => setLoading(false));
  }, []);

  const handleEdit = (cfg: ConfigEntry) => {
    setEditingKey(cfg.key);
    setEditValue(cfg.isSecret ? '' : cfg.value);
    setShowSecret(null);
  };

  const handleSave = async (key: string) => {
    if (!editValue.trim()) return;
    setSaving(true);
    try {
      await adminApi.put(`/config/${key}`, { value: editValue });
      showFeedback('success', 'Konfigurasi berhasil diperbarui');
      setEditingKey(null);
      const res = await adminApi.get('/config');
      setConfigs(res.data.data || []);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal menyimpan';
      showFeedback('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (key: string) => {
    setDeletingKey(key);
  };

  const handleReloadCache = async () => {
    setReloadLoading(true);
    try {
      const res = await adminApi.post('/config/reload-cache');
      showFeedback('success', res.data?.message || 'Cache berhasil diload ulang');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal reload cache';
      showFeedback('error', msg);
    } finally {
      setReloadLoading(false);
    }
  };

  const handleTestConnection = async (key: string, value: string) => {
    if (!value) {
      showFeedback('error', 'API key kosong — edit dulu untuk mengisi nilai');
      return;
    }
    setTestingKey(key);
    try {
      const service = key.toLowerCase().includes('groq') ? 'groq' : 'gemini';
      const res = await adminApi.post('/config/test-connection', { service, apiKey: value });
      const result = res.data?.data || {};
      if (result.status === 'valid') {
        showFeedback('success', `${key}: ${result.message}`);
      } else {
        showFeedback('error', `${key}: ${result.message || 'gagal tersambung'}`);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal test koneksi';
      showFeedback('error', msg);
    } finally {
      setTestingKey(null);
    }
  };

  // ─── Key Rotation handlers ───
  const handleDryRun = async () => {
    setDryRunLoading(true);
    setRotatingError(null);
    try {
      const res = await adminApi.post('/key-rotation/dry-run');
      const data = res.data?.data;
      setDryRunResult(data);
      setRotationStep('preview');
      showFeedback('success', `Dry-run: ${data.totalRows} baris, ${data.totalEncryptedFields} field terenkripsi`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal dry-run';
      setRotatingError(msg);
      showFeedback('error', msg);
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleExecuteRotation = async () => {
    if (!newKey.trim()) {
      setRotatingError('New encryption key is required');
      return;
    }
    if (confirmPhrase !== ROTATION_PHRASE) {
      setRotatingError(`Ketik "${ROTATION_PHRASE}" untuk konfirmasi`);
      return;
    }
    setRotationStep('executing');
    setRotatingError(null);
    try {
      const res = await adminApi.post('/key-rotation/execute', {
        newKey,
        confirmationPhrase: confirmPhrase,
      });
      const data = res.data?.data;
      setRotationResult(data);
      setRotationStep('done');
      showFeedback('success', `Key rotated: ${data.rowsReEncrypted} field values re-encrypted`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Gagal rotasi key';
      setRotatingError(msg);
      setRotationStep('confirm');
      showFeedback('error', msg);
    }
  };

  const resetRotation = () => {
    setRotationStep('idle');
    setDryRunResult(null);
    setNewKey('');
    setConfirmPhrase('');
    setRotationResult(null);
    setRotatingError(null);
  };

  const grouped = configs.reduce<Record<string, ConfigEntry[]>>((acc, cfg) => {
    const cat = cfg.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(cfg);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    ai: 'AI Services',
    ai_behavior: 'AI Behavior',
    integrations: 'Integrations',
    storage: 'Storage',
    backup: 'Backup',
    cache: 'Cache',
    general: 'General',
  };

  const categoryIcons: Record<string, string> = {
    ai: '🤖',
    ai_behavior: '🎛️',
    integrations: '🔌',
    storage: '💾',
    backup: '📦',
    cache: '⚡',
    general: '⚙️',
  };

  if (loading) {
    return (
      <div className="p-6 text-surface">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-5 h-5 text-cyan" />
          <div>
            <h1 className="font-display text-xl text-surface">Platform Config</h1>
            <p className="text-sm text-slate-400">System-wide configuration settings</p>
          </div>
        </div>
        <div className="space-y-4">
          {[1,2,3].map((i) => (
            <div key={i} className="bg-dcard rounded-lg border border-dline p-5">
              <div className="h-5 w-32 rounded bg-dline animate-pulse mb-4" />
              <div className="h-4 w-full rounded bg-dline/50 animate-pulse mb-2" />
              <div className="h-4 w-3/4 rounded bg-dline/50 animate-pulse" />
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
          <h1 className="font-display text-xl text-surface">Platform Config</h1>
          <p className="text-sm text-slate-400">System-wide configuration settings</p>
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

      {isSuperAdmin && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={handleReloadCache}
            disabled={reloadLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-300 border border-dline rounded-lg hover:bg-dline/20 disabled:opacity-50 transition font-mono"
          >
            {reloadLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reload Cache
          </button>
        </div>
      )}

      {Object.entries(grouped).map(([category, entries]) => (
        <div key={category} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{categoryIcons[category] || '⚙️'}</span>
            <h2 className="text-sm font-semibold text-slate-300">{categoryLabels[category] || category}</h2>
          </div>

          {category === 'ai' && (
            <div className="mb-3 px-4 py-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-sm text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Perubahan API key AI memerlukan restart server manual agar aktif.</span>
            </div>
          )}

          {category === 'ai_behavior' && (
            <div className="mb-3 px-4 py-3 rounded-lg bg-cyan/10 border border-cyan/20 text-sm text-cyan flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Perubahan pengaturan ini langsung berlaku (hot-reload) — tidak perlu restart server.</span>
            </div>
          )}

          {category === 'integrations' && (
            <div className="mb-3 px-4 py-3 rounded-lg bg-cyan/10 border border-cyan/20 text-sm text-cyan flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Perubahan ini langsung berlaku (hot-reload adapter) — tidak perlu restart server.</span>
            </div>
          )}

          <div className="bg-dcard rounded-lg border border-dline overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dline">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 w-1/3">Key</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Value</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dline">
                {entries.map((cfg) => {
                  const isEditing = editingKey === cfg.key;

                  const renderEdit = () => (
                    <div className="flex flex-col gap-2">
                      {cfg.value.includes('\n') ? (
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono text-xs resize-y min-h-[80px]"
                          autoFocus
                          disabled={saving}
                          rows={4}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              type={cfg.isSecret && !showSecret ? 'password' : 'text'}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface focus:outline-none focus:ring-2 focus:ring-cyan font-mono text-xs"
                              autoFocus
                              disabled={saving}
                            />
                            {cfg.isSecret && (
                              <button
                                onClick={() => setShowSecret(showSecret === cfg.key ? null : cfg.key)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-surface"
                              >
                                {showSecret === cfg.key ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(cfg.key)}
                          disabled={saving || !editValue.trim()}
                          className="p-1.5 text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setEditingKey(null)}
                          disabled={saving}
                          className="p-1.5 text-slate-400 hover:bg-dline/20 rounded-lg"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );

                  const renderActions = () => (
                    <>
                      {category === 'ai' && cfg.key.includes('_API_KEY') && isSuperAdmin && (
                        <button
                          onClick={() => handleTestConnection(cfg.key, cfg.value)}
                          disabled={testingKey === cfg.key}
                          className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg disabled:opacity-50"
                          title="Test connection"
                        >
                          {testingKey === cfg.key ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => handleDelete(cfg.key)}
                          disabled={deletingKey === cfg.key}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-50"
                          title="Hapus konfigurasi"
                        >
                          {deletingKey === cfg.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                      {isSuperAdmin ? (
                        <button
                          onClick={() => handleEdit(cfg)}
                          className="p-1.5 text-slate-400 hover:text-cyan hover:bg-cyan/10 rounded-lg"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Read only</span>
                      )}
                    </>
                  );

                  return (
                  <tr key={cfg.key} className="hover:bg-dline/10">
                    <td className="px-4 py-3">
                      <p className="font-medium text-surface text-xs font-mono">{cfg.key}</p>
                      {cfg.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{cfg.description}</p>
                      )}
                      {/* Mobile: inline value + always-visible actions */}
                      <div className="sm:hidden mt-2">
                        {isEditing ? renderEdit() : (
                          <>
                            <p className="text-xs font-mono text-slate-300 break-all mb-2">
                              {cfg.isSecret ? (showSecret === cfg.key ? cfg.value : '***') : cfg.value}
                            </p>
                            <div className="flex items-center gap-1">
                              {renderActions()}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    {/* Desktop: value/edit cell */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {isEditing ? renderEdit() : (
                        <span className="text-xs font-mono text-slate-300">
                          {cfg.isSecret ? (showSecret === cfg.key ? cfg.value : '***') : cfg.value}
                        </span>
                      )}
                    </td>
                    {/* Desktop: actions cell (always visible when not editing) */}
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      {!isEditing && (
                        <div className="flex justify-end gap-1">
                          {renderActions()}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {isSuperAdmin && (
        <div className="mt-8">
          <div className="bg-dcard rounded-lg border border-dline p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-dline">
              <Shield className="w-5 h-5 text-red-400" />
              <h2 className="text-lg font-display font-semibold text-surface">Key Rotation</h2>
              <Info className="w-4 h-4 text-slate-400 ml-auto" />
            </div>

            {rotationStep === 'done' && rotationResult && (
              <div className="mb-4 p-3 bg-cyan/10 border border-cyan/20 rounded-lg text-sm text-cyan flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Rotasi key berhasil!</p>
                  <p className="mt-1">
                    {rotationResult.rowsReEncrypted} field values berhasil di-re-encrypt
                    di model: {rotationResult.modelsAffected.join(', ')}.
                  </p>
                  <p className="mt-1">Key baru kini aktif di Platform Config DB.</p>
                </div>
              </div>
            )}

            {rotationStep === 'idle' && (
              <Fragment>
                <div className="mb-4 p-3 bg-dline/20 border border-dline rounded-lg text-sm">
                  <p className="font-medium text-slate-300 mb-1">Rotasi Encryption Key</p>
                  <p className="text-slate-400">
                    Dry-run akan menghitung berapa banyak data yang perlu di-re-encrypt tanpa melakukan perubahan apapun.
                  </p>
                </div>

                {dryRunResult && (
                  <div className="mb-4 p-3 bg-cyan/10 border border-cyan/20 rounded-lg text-sm text-cyan flex items-start gap-2">
                    <Database className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Dry-run Results:</p>
                      <p>{dryRunResult.totalRows} rows, {dryRunResult.totalEncryptedFields} encrypted fields across all models</p>
                      <p>Key source: {dryRunResult.currentSource}</p>
                    </div>
                  </div>
                )}

                {rotatingError && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    {rotatingError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleDryRun}
                    disabled={dryRunLoading}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-300 border border-dline rounded-lg hover:bg-dline/20 disabled:opacity-50 transition font-mono"
                  >
                    {dryRunLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                    Dry Run
                  </button>
                  {dryRunResult && (
                    <button
                      onClick={() => setRotationStep('preview')}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 font-mono"
                    >
                      <Key className="w-4 h-4" />
                      Lanjutkan
                    </button>
                  )}
                </div>
              </Fragment>
            )}

            {(rotationStep === 'preview' || rotationStep === 'confirm') && dryRunResult && (
              <Fragment>
                <div className="mb-4 p-4 bg-cyan/10 border border-cyan/20 rounded-lg">
                  <div className="space-y-2 mb-4">
                    {Object.entries(dryRunResult.models).map(([model, info]) => (
                      <div key={model} className="text-sm">
                        <p className="font-medium text-cyan">{model}: {info.rowCount} rows, {info.encryptedFieldCount} encrypted fields</p>
                        {Object.entries(info.fields).map(([field, count]) => (
                          count > 0 && (
                            <p key={field} className="text-cyan/70">  {field}: {count} encrypted values</p>
                          )
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-dline/20 rounded border border-dline">
                    <p className="text-sm text-slate-300 mb-2">Enter new encryption key:</p>
                    <input
                      type="text"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface font-mono text-xs"
                      placeholder="32-byte hex key"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Ketik &quot;{ROTATION_PHRASE}&quot; untuk konfirmasi.
                    </p>
                    <input
                      type="text"
                      value={confirmPhrase}
                      onChange={(e) => setConfirmPhrase(e.target.value)}
                      className="w-full px-3 py-1.5 bg-dcard border border-dline rounded-lg text-sm text-surface font-mono text-xs mt-2"
                      placeholder="Ketik frasa konfirmasi"
                    />
                  </div>

                  {rotatingError && (
                    <p className="text-sm text-red-400 mt-2">{rotatingError}</p>
                  )}

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handleExecuteRotation}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 font-mono"
                    >
                      <Key className="w-4 h-4" />
                      Konfirmasi &amp; Eksekusi
                    </button>
                    <button
                      onClick={resetRotation}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-300 border border-dline rounded-lg hover:bg-dline/20 font-mono"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </Fragment>
            )}

            {rotationStep === 'executing' && (
              <div className="mb-4 p-3 bg-amber-400/10 border border-amber-400/20 rounded-lg text-sm text-amber-300 flex items-start gap-2">
                <Loader2 className="w-4 h-4 animate-spin mt-0.5" />
                <span>Sedang mengenkripsi ulang semua data dengan key baru...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
