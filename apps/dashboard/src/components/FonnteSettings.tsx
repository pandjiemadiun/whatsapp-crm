import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type ViewState = 'loading' | 'connected' | 'disconnected' | 'error';

export type { ViewState };

export interface FonnteStatus {
  status: 'connected' | 'disconnected' | string;
  fonnteNumber: string;
}

export interface UseFonnteSettingsResult {
  // state
  step: number;
  setStep: (s: number) => void;
  viewState: ViewState;
  token: string;
  setToken: (v: string) => void;
  fonnteNumber: string;
  setFonnteNumber: (v: string) => void;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  connectedNumber: string;
  maskedToken: string;
  lastChecked: Date | null;
  saving: boolean;
  disconnecting: boolean;
  feedback: { type: 'success' | 'error'; msg: string } | null;
  webhookUrl: string;
  webhookLoading: boolean;
  webhookCopied: boolean;
  // actions
  fetchStatus: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleRotateWebhook: () => Promise<void>;
  handleCopyWebhook: () => Promise<void>;
  clearFeedback: () => void;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export { formatTime };

export default function useFonnteSettings(): UseFonnteSettingsResult {
  const { user } = useAuth();
  const storeId = user?.storeId;

  const [step, setStep] = useState(1);
  const [token, setToken] = useState('');
  const [fonnteNumber, setFonnteNumber] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [maskedToken, setMaskedToken] = useState('');
  const [connectedNumber, setConnectedNumber] = useState('');
  const [saving, setSaving] = useState(false);
  // P-PWA.17: konfirmasi-dialog flow sudah tidak ter-render (ConfirmDialog dihapus),
  // jadi setter untuk state loading/confirm yang tidak pernah ada caller-nya di-drop
  // lewat destructuring value-only. Value tetap dipakai di response/JSX konsumen.
  const [disconnecting] = useState(false);
  const [, setConfirmDialog] = useState<{ type: 'rotate' | 'disconnect' } | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };
  const clearFeedback = () => setFeedback(null);

  const loadWebhookUrl = useCallback(async () => {
    if (!storeId) return;
    try {
      const res = await api.get('/messages/webhook-url');
      if (res.data.success && res.data.data.webhookUrl) {
        setWebhookUrl(res.data.data.webhookUrl);
      }
    } catch {
      // Webhook URL belum ada / gagal — biarkan kosong, user bisa rotate.
    }
  }, [storeId]);

  const handleRotateWebhook = async () => {
    if (!storeId) return;
    setConfirmDialog({ type: 'rotate' });
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      showFeedback('error', 'Gagal menyalin URL. Salin manual.');
    }
  };

  useEffect(() => {
    loadWebhookUrl();
  }, [loadWebhookUrl]);

  const fetchStatus = useCallback(async () => {
    if (!storeId) {
      setViewState('disconnected');
      return;
    }
    setViewState('loading');
    try {
      const res = await api.get('/whatsapp/fonnte/status');
      const d = res.data.data;
      setLastChecked(new Date());
      if (d.status === 'connected') {
        setViewState('connected');
        setConnectedNumber(d.phoneNumber || d.foninteNumber || '');
        setMaskedToken('••••••••••••••••');
      } else {
        setViewState('disconnected');
        setConnectedNumber('');
        setMaskedToken('');
      }
    } catch {
      setViewState('error');
    }
  }, [storeId]);

  // ── Auto-advance step based on status ──
  const runFetchStatus = useCallback(async () => {
    if (!storeId) {
      setViewState('disconnected');
      return;
    }
    setViewState('loading');
    try {
      const res = await api.get('/whatsapp/fonnte/status');
      const d = res.data.data;
      setLastChecked(new Date());
      if (d.status === 'connected') {
        setViewState('connected');
        setConnectedNumber(d.fonnteNumber || '');
        setMaskedToken('••••••••••••••••');
        setStep(3);
      } else {
        setViewState('disconnected');
        setConnectedNumber('');
        setMaskedToken('');
        setStep(1);
      }
    } catch {
      setViewState('error');
    }
  }, [storeId]);

  useEffect(() => {
    runFetchStatus();
  }, [runFetchStatus]);

  const handleSave = async () => {
    if (!storeId || !token.trim() || !fonnteNumber.trim()) return;

    setSaving(true);
    setFeedback(null);

    try {
      const res = await api.put('/auth/profile', {
        storeId,
        fonnteToken: token.trim(),
        fonnteNumber: fonnteNumber.trim(),
      });

      if (res.data.success) {
        setViewState('connected');
        setConnectedNumber(fonnteNumber.trim());
        setMaskedToken('••••••••••••••••');
        setLastChecked(new Date());
        setStep(3);
        showFeedback('success', 'Fonnte gateway connected successfully.');
      } else {
        showFeedback('error', res.data.error || 'Failed to save token.');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save token';
      showFeedback('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!storeId) return;
    setConfirmDialog({ type: 'disconnect' });
  };

  return {
    step, setStep,
    viewState, token, setToken, fonnteNumber, setFonnteNumber,
    showToken, setShowToken,
    connectedNumber, maskedToken, lastChecked,
    saving, disconnecting,
    feedback, clearFeedback,
    webhookUrl, webhookLoading, webhookCopied,
    fetchStatus, handleSave, handleDisconnect,
    handleRotateWebhook, handleCopyWebhook,
  };
}
