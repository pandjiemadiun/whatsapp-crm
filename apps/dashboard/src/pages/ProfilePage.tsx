import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Camera, Lock, Pencil, Trash2, Upload, Plus, Truck, BookOpen, AlertCircle, ChevronDown, Store, CreditCard } from 'lucide-react';
import api from '../services/api';
import { TIMEZONES } from '../lib/timezones';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

type OperatingHoursDay = {
  open: boolean;
  start: string;
  end: string;
};

type OperatingHoursData = {
  v: number;
  days: Record<string, OperatingHoursDay>;
  summary: string;
};

interface ProfileData {
  name: string;
  email: string;
  phoneNumber: string | null;
  description: string | null;
  businessCategory: string | null;
  address: string | null;
  profilePhotoUrl: string | null;
  timezone: string;
  operatingHours: any;
  acceptsTransfer: boolean;
  acceptsQris: boolean;
  acceptsCod: boolean;
  qrisImageUrl: string | null;
shippingMode: 'pickup' | 'flat';
  shippingFlatInCity: number | null;
  shippingFlatOutCity: number | null;
}

interface BankAccount {
  id: string;
  storeId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/* ── Operating hours helpers ── */

const DAYS_SENSIBLE: { id: string; label: string; full: string }[] = [
  { id: 'senin', label: 'Sen', full: 'Senin' },
  { id: 'selasa', label: 'Sel', full: 'Selasa' },
  { id: 'rabu', label: 'Rab', full: 'Rabu' },
  { id: 'kamis', label: 'Kam', full: 'Kamis' },
  { id: 'jumat', label: 'Jum', full: 'Jumat' },
  { id: 'sabtu', label: 'Sab', full: 'Sabtu' },
  { id: 'minggu', label: 'Min', full: 'Minggu' },
];

const DOW_ORDER = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

const DOW_ABBR: Record<string, string> = {
  senin: 'Sen', selasa: 'Sel', rabu: 'Rab', kamis: 'Kam',
  jumat: 'Jum', sabtu: 'Sab', minggu: 'Min',
};

function formatTimeRange(start: string, end: string): string {
  return `${start}–${end}`;
}

function generateSummary(days: Record<string, OperatingHoursDay>): string {
  const openDays = DOW_ORDER.filter((d) => days[d]?.open);
  if (openDays.length === 0) return 'Tutup setiap hari';

  const groups: string[] = [];
  let cur: string[] = [openDays[0]];
  let curStart = days[openDays[0]].start;
  let curEnd = days[openDays[0]].end;

  for (let i = 1; i < openDays.length; i++) {
    const d = openDays[i];
    const idx = DOW_ORDER.indexOf(d);
    const prevIdx = DOW_ORDER.indexOf(openDays[i - 1]);

    if (idx === prevIdx + 1 && days[d].start === curStart && days[d].end === curEnd) {
      cur.push(d);
    } else {
      groups.push(cur.length === 1
        ? `${DOW_ABBR[cur[0]]} ${formatTimeRange(curStart, curEnd)}`
        : `${DOW_ABBR[cur[0]]}–${DOW_ABBR[cur[cur.length - 1]]} ${formatTimeRange(curStart, curEnd)}`);
      cur = [d];
      curStart = days[d].start;
      curEnd = days[d].end;
    }
  }
  groups.push(cur.length === 1
    ? `${DOW_ABBR[cur[0]]} ${formatTimeRange(curStart, curEnd)}`
    : `${DOW_ABBR[cur[0]]}–${DOW_ABBR[cur[cur.length - 1]]} ${formatTimeRange(curStart, curEnd)}`);

  if (openDays.length === 7 && groups.length === 1) {
    return `Setiap hari ${formatTimeRange(curStart, curEnd)}`;
  }
  return groups.join(' · ');
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, updateUserProfile } = useAuth();

  // Section refs for sticky nav
  const profileRef = useRef<HTMLDivElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const shippingRef = useRef<HTMLDivElement>(null);
  const sopRef = useRef<HTMLDivElement>(null);
  const securityRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('profile');

  const [loading, setLoading] = useState(true);
  const [profileDataLoaded, setProfileDataLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', businessCategory: '', address: '', phoneNumber: '', timezone: 'Asia/Jakarta',
  });

  const [operatingHours, setOperatingHours] = useState<OperatingHoursData>({
    v: 2,
    days: {},
    summary: '',
  });

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [pwFeedback, setPwFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [paymentFeedback, setPaymentFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [shippingFeedback, setShippingFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [sopFeedback, setSopFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [savingPayments, setSavingPayments] = useState(false);

  const [paymentMethods, setPaymentMethods] = useState({
    acceptsTransfer: false,
    acceptsQris: false,
    acceptsCod: false,
    qrisImageUrl: '',
  });
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);

  // Bank accounts state
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editingBank, setEditingBank] = useState({ bankName: '', accountNumber: '', accountName: '' });
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  // QRIS image upload
  const [qrisUploadLoading, setQrisUploadLoading] = useState(false);
  const qrisFileInputRef = useRef<HTMLInputElement>(null);

  // Shipping settings state
  const [shippingMode, setShippingMode] = useState<'pickup' | 'flat'>('pickup');
  const [shippingFlatInCity, setShippingFlatInCity] = useState<number | ''>('');
  const [shippingFlatOutCity, setShippingFlatOutCity] = useState<number | ''>('');
  const [shippingLoading, setShippingLoading] = useState(true);
const [savingShipping, setSavingShipping] = useState(false);

  // SOP state
  const [sopData, setSopData] = useState<Record<string, string>>({});
  const [savingSop, setSavingSop] = useState(false);
  const [sopLoadError, setSopLoadError] = useState(false);

  // Dirty-state tracking per section (Option B)
  const [profileDirty, setProfileDirty] = useState(false);
  const [paymentDirty, setPaymentDirty] = useState(false);
  const [shippingDirty, setShippingDirty] = useState(false);
  const [sopDirty, setSopDirty] = useState(false);
  const [, setSavedFlags] = useState<{ profile?: boolean; payment?: boolean; shipping?: boolean; sop?: boolean }>({});

  // SOP per-category state
  const [expandedSop, setExpandedSop] = useState<Record<string, boolean>>({
    order: true, komplain: false, retur: false, garansi: false, stok_habis: false,
  });
  const [sopDirtyMap, setSopDirtyMap] = useState<Record<string, boolean>>({});
  const [sopSavingMap, setSopSavingMap] = useState<Record<string, boolean>>({});
  const [sopCatFeedback, setSopCatFeedback] = useState<Record<string, { type: 'success' | 'error'; msg: string }>>({});

  // Bank account delete confirmation
  const [bankDeleteConfirm, setBankDeleteConfirm] = useState<BankAccount | null>(null);

  const anyDirty =
    profileDirty || paymentDirty || shippingDirty || sopDirty;

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };
  const showPwFeedback = (type: 'success' | 'error', msg: string) => {
    setPwFeedback({ type, msg });
    setTimeout(() => setPwFeedback(null), 4000);
  };
  const showPaymentFeedback = (type: 'success' | 'error', msg: string) => {
    setPaymentFeedback({ type, msg });
    setTimeout(() => setPaymentFeedback(null), 4000);
  };
  const showShippingFeedback = (type: 'success' | 'error', msg: string) => {
    setShippingFeedback({ type, msg });
    setTimeout(() => setShippingFeedback(null), 4000);
  };
  const showSopFeedback = (type: 'success' | 'error', msg: string) => {
    setSopFeedback({ type, msg });
    setTimeout(() => setSopFeedback(null), 4000);
  };

  // beforeUnload warning for unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  // Track active section for sticky nav highlight
  useEffect(() => {
    const handleScroll = () => {
      const offset = 160;
      const refs = [
        { key: 'profile', ref: profileRef },
        { key: 'payment', ref: paymentRef },
        { key: 'shipping', ref: shippingRef },
        { key: 'sop', ref: sopRef },
        { key: 'security', ref: securityRef },
      ];
      let current = 'profile';
      for (const { key, ref } of refs) {
        if (ref.current && window.scrollY >= ref.current.offsetTop - offset) {
          current = key;
        }
      }
      setActiveSection(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  });

  useEffect(() => {
    api.get('/profile')
      .then((res) => {
        const d: ProfileData = res.data.data;
        setProfile(d);
        setForm({
          name: d.name || '',
          description: d.description || '',
          businessCategory: d.businessCategory || '',
          address: d.address || '',
          phoneNumber: d.phoneNumber || '',
          timezone: d.timezone || 'Asia/Jakarta',
        });

        // Parse operating hours — v2 object or legacy string/null → default
        const defaultDay: OperatingHoursDay = { open: true, start: '08:00', end: '22:00' };
        const defaultDays: Record<string, OperatingHoursDay> = {};
        DOW_ORDER.forEach((dow) => defaultDays[dow] = { ...defaultDay });

        let parsed: OperatingHoursData;
        if (d.operatingHours && typeof d.operatingHours === 'object' && d.operatingHours.v === 2) {
          parsed = {
            v: 2,
            days: { ...defaultDays, ...d.operatingHours.days },
            summary: '',
          };
        } else {
          parsed = { v: 2, days: defaultDays, summary: '' };
        }
        parsed.summary = generateSummary(parsed.days);
        setOperatingHours(parsed);
        setPaymentMethods({
          acceptsTransfer: d.acceptsTransfer ?? false,
          acceptsQris: d.acceptsQris ?? false,
          acceptsCod: d.acceptsCod ?? false,
          qrisImageUrl: d.qrisImageUrl ?? '',
        });
        setPaymentMethodsLoading(false);
        setShippingMode(d.shippingMode || 'pickup');
setShippingFlatInCity(d.shippingFlatInCity ?? '');
        setShippingFlatOutCity(d.shippingFlatOutCity ?? '');
        setShippingLoading(false);
        setProfileDataLoaded(true);

        api.get('/sop')
          .then((res) => {
            const sops = res.data.data || [];
            const map: Record<string, string> = {};
            sops.forEach((s: any) => { map[s.category] = s.content; });
            setSopData(map);
            setSopLoadError(false);
          })
          .catch(() => { setSopLoadError(true); });
      })
.catch(() => {
      showFeedback('error', 'Failed to load profile');
      setPaymentMethodsLoading(false);
      setShippingLoading(false);
    })
      .finally(() => setLoading(false));
  }, []);

  const fetchSops = useCallback(async () => {
    setSopLoadError(false);
    try {
      const res = await api.get('/sop');
      const sops = res.data.data || [];
      const map: Record<string, string> = {};
      sops.forEach((s: any) => { map[s.category] = s.content; });
      setSopData(map);
      setSopLoadError(false);
    } catch {
      setSopLoadError(true);
    }
  }, []);

  // Fetch bank accounts when Transfer Bank is enabled
  const fetchBankAccounts = useCallback(async () => {
    if (!paymentMethods.acceptsTransfer) return;
    setLoadingBanks(true);
    try {
      const res = await api.get('/bank-accounts');
      setBankAccounts(res.data.data || []);
    } catch (err: any) {
      showPaymentFeedback('error', err?.response?.data?.error || 'Gagal memuat rekening bank');
    } finally {
      setLoadingBanks(false);
    }
  }, [paymentMethods.acceptsTransfer]);

  useEffect(() => {
    fetchBankAccounts();
  }, [fetchBankAccounts]);

  // ─── Bank Account CRUD handlers ───
  const startAddBank = () => {
    setEditingBankId('new');
    setEditingBank({ bankName: '', accountNumber: '', accountName: '' });
  };

  const startEditBank = (bank: BankAccount) => {
    setEditingBankId(bank.id);
    setEditingBank({ bankName: bank.bankName, accountNumber: bank.accountNumber, accountName: bank.accountName });
  };

  const cancelBankEdit = () => {
    setEditingBankId(null);
    setEditingBank({ bankName: '', accountNumber: '', accountName: '' });
  };

  const saveBank = async () => {
    if (!editingBank.bankName || !editingBank.accountNumber || !editingBank.accountName) {
      showPaymentFeedback('error', 'Nama bank, nomor rekening, dan nama pemilik wajib diisi');
      return;
    }
    setSavingBank(true);
    try {
      if (editingBankId === 'new') {
        await api.post('/bank-accounts', editingBank);
        showPaymentFeedback('success', 'Rekening berhasil ditambahkan');
      } else {
        await api.put(`/bank-accounts/${editingBankId}`, editingBank);
        showPaymentFeedback('success', 'Rekening berhasil diperbarui');
      }
      cancelBankEdit();
      fetchBankAccounts();
    } catch (err: any) {
      showPaymentFeedback('error', err?.response?.data?.error || 'Gagal menyimpan rekening');
    } finally {
      setSavingBank(false);
    }
  };

  const deleteBank = (bank: BankAccount) => {
    setBankDeleteConfirm(bank);
  };

  const confirmDeleteBank = async () => {
    if (!bankDeleteConfirm) return;
    const id = bankDeleteConfirm.id;
    setBankDeleteConfirm(null);
    try {
      await api.delete(`/bank-accounts/${id}`);
      showPaymentFeedback('success', 'Rekening berhasil dihapus');
      fetchBankAccounts();
    } catch (err: any) {
      showPaymentFeedback('error', err?.response?.data?.error || 'Gagal menghapus rekening');
    }
  };

  // ─── QRIS image upload ───
  const handleQrisUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showPaymentFeedback('error', 'File harus berupa gambar');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      showPaymentFeedback('error', 'Ukuran gambar maksimal 3MB');
      return;
    }
    setQrisUploadLoading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await api.post('/auth/profile/qris-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.success) {
        setPaymentMethods({ ...paymentMethods, qrisImageUrl: res.data.data.qrisImageUrl });
        showPaymentFeedback('success', 'QRIS image berhasil diupload');
      }
    } catch (err: any) {
      showPaymentFeedback('error', err?.response?.data?.error || 'Gagal upload QRIS image');
    } finally {
      setQrisUploadLoading(false);
      e.target.value = '';
    }
  };

  const handlePhotoClick = () => fileInputRef.current?.click();

  const handleSave = async () => {
    if (!form.name.trim()) {
      showFeedback('error', 'Nama toko wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const regenerated = generateSummary(operatingHours.days);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        businessCategory: form.businessCategory.trim() || null,
        address: form.address.trim() || null,
        phoneNumber: form.phoneNumber.trim() || null,
        timezone: form.timezone,
        operatingHours: { v: 2, days: operatingHours.days, summary: regenerated },
      };
      const res = await api.put('/profile', payload);
      if (res.data.success) {
        updateUserProfile({ storeName: form.name.trim() });
        showFeedback('success', 'Profil berhasil disimpan');
        setProfileDirty(false);
        setSavedFlags(f => ({ ...f, profile: true }));
        setTimeout(() => setSavedFlags(f => { const n = { ...f }; delete n.profile; return n; }), 3000);
      }
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || 'Gagal menyimpan profil');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayments = async () => {
    setSavingPayments(true);
    try {
      const res = await api.put('/auth/profile', {
        acceptsTransfer: paymentMethods.acceptsTransfer,
        acceptsQris: paymentMethods.acceptsQris,
        acceptsCod: paymentMethods.acceptsCod,
        qrisImageUrl: paymentMethods.qrisImageUrl || null,
      });
      if (res.data.success) {
        showPaymentFeedback('success', 'Tersimpan ✓');
        setPaymentDirty(false);
        setSavedFlags(f => ({ ...f, payment: true }));
        setTimeout(() => setSavedFlags(f => { const n = { ...f }; delete n.payment; return n; }), 3000);
      }
    } catch (err: any) {
      showPaymentFeedback('error', err?.response?.data?.error || 'Gagal menyimpan metode pembayaran');
    } finally {
      setSavingPayments(false);
    }
  };

  const handleSaveShipping = async () => {
    setSavingShipping(true);
    try {
      const res = await api.put('/auth/profile', {
        shippingMode,
        shippingFlatInCity: shippingMode === 'flat' ? (shippingFlatInCity || 0) : null,
        shippingFlatOutCity: shippingMode === 'flat' ? (shippingFlatOutCity || 0) : null,
      });
      if (res.data.success) {
        showShippingFeedback('success', 'Tersimpan ✓');
        setShippingDirty(false);
        setSavedFlags(f => ({ ...f, shipping: true }));
        setTimeout(() => setSavedFlags(f => { const n = { ...f }; delete n.shipping; return n; }), 3000);
      }
    } catch (err: any) {
      showShippingFeedback('error', err?.response?.data?.error || 'Gagal menyimpan pengiriman');
    } finally {
      setSavingShipping(false);
    }
  };

  const handleSaveSopCategory = async (cat: string) => {
    setSopSavingMap((m) => ({ ...m, [cat]: true }));
    try {
      const res = await api.put(`/sop/${cat}`, { content: sopData[cat] ?? '' });
      if (res.data?.success) {
        setSopCatFeedback((m) => ({ ...m, [cat]: { type: 'success', msg: 'Tersimpan ✓' } }));
        setSopDirtyMap((m) => ({ ...m, [cat]: false }));
        setTimeout(() => {
          setSopCatFeedback((prev) => {
            const n = { ...prev };
            delete n[cat];
            return n;
          });
        }, 3000);
      } else {
        setSopCatFeedback((m) => ({ ...m, [cat]: { type: 'error', msg: res.data?.error || 'Gagal menyimpan' } }));
      }
    } catch (err: any) {
      setSopCatFeedback((m) => ({ ...m, [cat]: { type: 'error', msg: err?.response?.data?.error || 'Gagal menyimpan SOP' } }));
    } finally {
      setSopSavingMap((m) => ({ ...m, [cat]: false }));
    }
  };

  const handleSaveAllSop = async () => {
    setSavingSop(true);
    try {
      const categories = ['order', 'komplain', 'retur', 'garansi', 'stok_habis'];
      for (const cat of categories) {
        await api.put(`/sop/${cat}`, { content: sopData[cat] ?? '' });
      }
      showSopFeedback('success', 'Tersimpan ✓');
      setSopDirty(false);
      setSavedFlags(f => ({ ...f, sop: true }));
      setTimeout(() => setSavedFlags(f => { const n = { ...f }; delete n.sop; return n; }), 3000);
    } catch (err: any) {
      showSopFeedback('error', err?.response?.data?.error || 'Gagal menyimpan SOP');
    } finally {
      setSavingSop(false);
    }
  };

  const handleChangePassword = async () => {
    if (!pwForm.currentPassword || !pwForm.newPassword) {
      showPwFeedback('error', 'Semua field password wajib diisi');
      return;
    }
    if (pwForm.newPassword.length < 6) {
      showPwFeedback('error', 'Password baru minimal 6 karakter');
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      showPwFeedback('error', 'Konfirmasi password tidak cocok');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api.put('/profile/password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      if (res.data.success) {
        showPwFeedback('success', 'Password berhasil diubah');
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      }
    } catch (err: any) {
      showPwFeedback('error', err?.response?.data?.error || 'Gagal mengubah password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || !profileDataLoaded) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-40 rounded bg-line animate-pulse mb-4" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6 space-y-4">
            <div className="h-4 w-24 rounded bg-line animate-pulse" />
            <div className="space-y-2">
              <div className="h-9 rounded bg-line animate-pulse w-full" />
              <div className="h-9 rounded bg-line animate-pulse w-full" />
              <div className="h-9 rounded bg-line animate-pulse w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Operating hours picker helpers ──
  const openAllDays = () => {
    const days: Record<string, OperatingHoursDay> = {};
    DOW_ORDER.forEach((d) => days[d] = { open: true, start: '08:00', end: '22:00' });
    const next = { v: 2, days, summary: generateSummary(days) };
    setOperatingHours(next);
    setProfileDirty(true);
  };
  const closeAllDays = () => {
    const days: Record<string, OperatingHoursDay> = {};
    DOW_ORDER.forEach((d) => days[d] = { open: false, start: '08:00', end: '22:00' });
    const next = { v: 2, days, summary: generateSummary(days) };
    setOperatingHours(next);
    setProfileDirty(true);
  };
  const toggleDay = (dayId: string) => {
    const day = operatingHours.days[dayId] ?? { open: false, start: '08:00', end: '22:00' };
    const days = { ...operatingHours.days, [dayId]: { ...day, open: !day.open } };
    setOperatingHours({ v: 2, days, summary: generateSummary(days) });
    setProfileDirty(true);
  };
  const updateDayTime = (dayId: string, field: 'start' | 'end', value: string) => {
    const day = operatingHours.days[dayId] ?? { open: false, start: '08:00', end: '22:00' };
    const days = { ...operatingHours.days, [dayId]: { ...day, [field]: value } };
    setOperatingHours({ v: 2, days, summary: generateSummary(days) });
    setProfileDirty(true);
  };

  const initials = (form.name || profile?.email || '?').trim().charAt(0).toUpperCase();

  /** SectionCard header — flat, no overlapping: icon | title+dot / helper | save */
  const SectionHeader = ({ icon, title, helper, feedback, saveDisabled, onSave, saving, saveLabel, dirty }: {
    icon: React.ReactNode;
    title: string;
    helper: string;
    feedback?: { type: 'success' | 'error'; msg: string } | null;
    saveDisabled: boolean;
    onSave: () => void;
    saving: boolean;
    saveLabel: string;
    dirty?: boolean;
  }) => (
    <div className="flex items-start gap-3 mb-4">
      <div className="rounded-xl bg-brand-soft dark:bg-brand/15 p-2.5 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-ink dark:text-surface">{title}</h3>
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 shrink-0"></span>}
        </div>
        <p className="text-xs text-muted dark:text-gray-500 mt-0.5">{helper}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {feedback && (
          <span className={`text-xs font-medium ${
            feedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </span>
        )}
        <button
          onClick={onSave}
          disabled={saving || saveDisabled}
          className="flex items-center justify-center gap-1.5 bg-brand text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition shrink-0 w-full sm:w-auto"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {saveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/dashboard')} className="text-muted hover:text-ink transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-display font-bold text-navy dark:text-surface">Profil Toko</h1>
          <p className="text-sm text-muted">Kelola informasi dan pengaturan akun toko Anda</p>
        </div>
      </div>

      {/* Global unsaved-changes banner */}
      {anyDirty && (
        <div className="px-4 py-3 rounded-lg text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Anda punya perubahan belum tersimpan. Jangan tutup halaman sebelum menyimpan.</span>
        </div>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* Sticky section navigation */}
        <nav className="sticky top-14 z-10 -mx-6 mb-4 bg-surface dark:bg-dcard border-b border-line dark:border-dline">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {[
              { key: 'profile', label: 'Informasi', ref: profileRef, dirty: profileDirty },
              { key: 'payment', label: 'Pembayaran', ref: paymentRef, dirty: paymentDirty },
              { key: 'shipping', label: 'Pengiriman', ref: shippingRef, dirty: shippingDirty },
              { key: 'sop', label: 'SOP', ref: sopRef, dirty: sopDirty },
              { key: 'security', label: 'Keamanan', ref: securityRef, dirty: false },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => item.ref.current?.scrollIntoView({ behavior: 'smooth' })}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition ${
                  activeSection === item.key
                    ? 'text-brand border-b-2 border-brand'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {item.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500"></span>}
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        {/* PS2+PO3: Global Simpan Semua Perubahan */}
        {anyDirty && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Ada {Object.entries({profile: profileDirty, payment: paymentDirty, shipping: shippingDirty, sop: sopDirty}).filter(([_,v]) => v).length} bagian dengan perubahan belum disave.</span>
            </div>
            <button
              onClick={async () => {
                const errors: string[] = [];
                if (profileDirty) { try { await handleSave(); } catch(e) { errors.push('Profil'); } }
                if (paymentDirty) { try { await handleSavePayments(); } catch(e) { errors.push('Pembayaran'); } }
                if (shippingDirty) { try { await handleSaveShipping(); } catch(e) { errors.push('Pengiriman'); } }
                if (sopDirty) { try { await handleSaveAllSop(); } catch(e) { errors.push('SOP'); } }
                setSectionError(errors.reduce((acc, s) => ({ ...acc, [s.toLowerCase().replace('profil','profile').replace('pembayaran','payment').replace('pengiriman','shipping').replace('sop','sop')]: 'Gagal menyimpan' }), {}));
              }}
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand transition shrink-0"
            >
              Simpan Semua Perubahan
            </button>
          </div>
        )}

        {/* 1. Informasi Toko */}
        <div ref={profileRef} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6">
          <SectionHeader
            icon={<Store className="w-5 h-5 text-brand" />}
            title="Informasi Toko"
            helper="Identitas & jam operasional"
            feedback={feedback}
            saveDisabled={!profileDirty}
            onSave={handleSave}
            saving={saving}
            saveLabel="Simpan"
            dirty={profileDirty}
          />
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="relative">
                {profile?.profilePhotoUrl ? (
                  <img src={profile.profilePhotoUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover border border-line" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-brand-soft dark:bg-brand/15 text-brand flex items-center justify-center text-xl font-semibold">
                    {initials}
                  </div>
                )}
                <button
                  onClick={handlePhotoClick}
                  disabled={uploadingPhoto}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center hover:bg-brand-deep disabled:opacity-50 transition"
                  title="Ganti foto"
                >
                  {uploadingPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div>
                <p className="text-sm font-medium text-ink dark:text-surface">{form.name || 'Nama Toko'}</p>
                <p className="text-xs text-muted">{profile?.email}</p>
                <p className="text-xs text-muted font-mono mt-0.5">ID: {user?.storeId}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink dark:text-surface">Nama Toko <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => { setForm({ ...form, name: e.target.value }); setProfileDirty(true); }}
                  disabled={saving}
                  className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink dark:text-surface">Kategori Bisnis <span className="text-xs text-muted">(opsional)</span></label>
                <input
                  type="text"
                  value={form.businessCategory}
                  onChange={(e) => { setForm({ ...form, businessCategory: e.target.value }); setProfileDirty(true); }}
                  disabled={saving}
                  placeholder="Kuliner, Fashion, dll"
                  className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink dark:text-surface">Deskripsi Toko <span className="text-xs text-muted">(opsional)</span></label>
              <textarea
                value={form.description}
                onChange={(e) => { setForm({ ...form, description: e.target.value }); setProfileDirty(true); }}
                disabled={saving}
                rows={3}
                placeholder="Contoh: Toko kue rumahan, buka Senin-Sabtu"
                className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 resize-y"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink dark:text-surface">Nomor Kontak <span className="text-xs text-muted">(opsional)</span></label>
                <input
                  type="tel"
                  value={form.phoneNumber}
                  onChange={(e) => { setForm({ ...form, phoneNumber: e.target.value }); setProfileDirty(true); }}
                  disabled={saving}
                  placeholder="628123456789"
                  className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-ink dark:text-surface">Timezone</label>
                <select
                  value={form.timezone}
                  onChange={(e) => { setForm({ ...form, timezone: e.target.value }); setProfileDirty(true); }}
                  disabled={saving}
                  className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-ink dark:text-surface">Alamat <span className="text-xs text-muted">(opsional)</span></label>
              <textarea
                value={form.address}
                onChange={(e) => { setForm({ ...form, address: e.target.value }); setProfileDirty(true); }}
                disabled={saving}
                rows={2}
                placeholder="Jl. Contoh No. 1, Jakarta"
                className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 resize-y"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink dark:text-surface">Jam Operasional</label>
                <div className="flex gap-1">
                  <button
                    onClick={openAllDays}
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-transparent text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 transition"
                  >
                    Buka semua
                  </button>
                  <button
                    onClick={closeAllDays}
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-transparent text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 transition"
                  >
                    Tutup semua
                  </button>
                </div>
              </div>

              <div className="border border-line dark:border-dline rounded-lg overflow-hidden">
                {DAYS_SENSIBLE.map((day, idx) => {
                    const dayData = operatingHours.days[day.id] ?? { open: false, start: '08:00', end: '22:00' };
                    return (
                      <div key={day.id} className={`flex items-center gap-1.5 px-2 py-1 ${idx > 0 ? 'border-t border-line dark:border-dline' : ''}`}>
                        <button
                          type="button"
                          onClick={() => toggleDay(day.id)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${dayData.open ? 'bg-brand' : 'bg-line dark:bg-dline'}`}
                          aria-label={dayData.open ? 'Buka' : 'Tutup'}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-surface transition ${dayData.open ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                        <label className="text-sm font-medium text-ink dark:text-surface flex-1 min-w-0 whitespace-nowrap">
                          <span className="lg:hidden">{day.label}</span>
                          <span className="hidden lg:inline">{day.full}</span>
                        </label>
                        {dayData.open && (
                          <>
                            <input
                              type="time"
                              value={dayData.start}
                              onChange={(e) => updateDayTime(day.id, 'start', e.target.value)}
                              className="px-2 py-1 border border-line dark:border-dline rounded text-xs bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand w-[5.2rem] shrink-0"
                            />
                            <span className="text-muted text-xs">–</span>
                            <input
                              type="time"
                              value={dayData.end}
                              onChange={(e) => updateDayTime(day.id, 'end', e.target.value)}
                              className="px-2 py-1 border border-line dark:border-dline rounded text-xs bg-surface dark:bg-dsurface text-ink focus:outline-none focus:ring-1 focus:ring-brand w-[5.2rem] shrink-0"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted dark:text-gray-500 mt-2">{operatingHours.summary || 'Belum ada jam operasional'}</p>
              </div>
            </div>
          </div>

        {/* 2-3. Pembayaran & Pengiriman — side by side on lg */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 2. Pembayaran & Rekening */}
          <div ref={paymentRef} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6">
            <SectionHeader
              icon={<CreditCard className="w-5 h-5 text-brand" />}
              title="Pembayaran & Rekening"
              helper="Metode bayar, QRIS, rekening"
              feedback={paymentFeedback}
              saveDisabled={!paymentDirty}
              onSave={handleSavePayments}
              saving={savingPayments}
              saveLabel="Simpan"
              dirty={paymentDirty}
            />
            <div className="space-y-4">
              {paymentMethodsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded bg-line animate-pulse" />
                      <div className={`h-3 bg-line animate-pulse rounded ${i === 1 ? 'w-24' : i === 2 ? 'w-16' : 'w-20'}`} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paymentMethods.acceptsTransfer}
                    onChange={(e) => { setPaymentMethods({ ...paymentMethods, acceptsTransfer: e.target.checked }); setPaymentDirty(true); }}
                    disabled={savingPayments}
                    className="w-4 h-4 rounded border-line text-brand focus:ring-brand disabled:opacity-50"
                  />
                  <span className="text-sm font-medium text-ink dark:text-surface">Transfer Bank</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paymentMethods.acceptsQris}
                    onChange={(e) => { setPaymentMethods({ ...paymentMethods, acceptsQris: e.target.checked }); setPaymentDirty(true); }}
                    disabled={savingPayments}
                    className="w-4 h-4 rounded border-line text-brand focus:ring-brand disabled:opacity-50"
                  />
                  <span className="text-sm font-medium text-ink dark:text-surface">QRIS</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paymentMethods.acceptsCod}
                    onChange={(e) => { setPaymentMethods({ ...paymentMethods, acceptsCod: e.target.checked }); setPaymentDirty(true); }}
                    disabled={savingPayments}
                    className="w-4 h-4 rounded border-line text-brand focus:ring-brand disabled:opacity-50"
                  />
                  <span className="text-sm font-medium text-ink dark:text-surface">COD / Bayar di Tempat</span>
                </label>
                </div>
              )}
              {paymentMethods.acceptsTransfer && (
                <div className="space-y-4 pt-2">
                  {loadingBanks ? (
                    <div className="text-center py-4 text-sm text-muted">Memuat rekening bank...</div>
                  ) : bankAccounts.filter((b) => !b.deletedAt).length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted">Belum ada rekening bank</div>
                  ) : (
                    <div className="space-y-2.5">
                      {bankAccounts.filter((b) => !b.deletedAt).map((bank) => (
                        <div key={bank.id} className="border border-line dark:border-dline rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm text-ink dark:text-surface">{bank.bankName}</p>
                            <p className="text-sm text-muted">No. {bank.accountNumber}</p>
                            <p className="text-xs text-muted">Nama Pemilik Rekening: {bank.accountName}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditBank(bank)}
                              className="p-1 text-muted hover:text-brand transition"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteBank(bank)}
                              className="p-1 text-muted hover:text-red-600 transition"
                              title="Hapus"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {editingBankId && (
                    <div className="border border-line dark:border-dline rounded-lg p-4 space-y-3">
                      <h4 className="text-sm font-medium text-ink dark:text-surface">
                        {editingBankId === 'new' ? 'Tambah Rekening Baru' : 'Edit Rekening'}
                      </h4>
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Nama Bank"
                          value={editingBank.bankName}
                          onChange={(e) => setEditingBank({ ...editingBank, bankName: e.target.value })}
                          className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                        <input
                          type="text"
                          placeholder="Nomor Rekening"
                          value={editingBank.accountNumber}
                          onChange={(e) => setEditingBank({ ...editingBank, accountNumber: e.target.value })}
                          className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                        <input
                          type="text"
                          placeholder="Nama Pemilik Rekening"
                          value={editingBank.accountName}
                          onChange={(e) => setEditingBank({ ...editingBank, accountName: e.target.value })}
                          className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={cancelBankEdit}
                          className="px-4 py-2 text-muted dark:text-gray-500 rounded-lg text-sm font-medium hover:bg-surface dark:hover:bg-dline transition"
                        >
                          Batal
                        </button>
                        <button
                          onClick={saveBank}
                          disabled={savingBank}
                          className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:opacity-50 transition w-full sm:w-auto"
                        >
                          {savingBank ? 'Menyimpan...' : 'Simpan'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!editingBankId && (
                    <button
                      onClick={startAddBank}
                      className="flex items-center justify-center gap-2 border border-line text-muted px-4 py-2 rounded-lg text-sm font-medium hover:bg-surface dark:hover:bg-dline transition"
                    >
                      <Plus className="w-4 h-4" />
                      Tambah Rekening Bank
                    </button>
                  )}
                </div>
              )}

              {paymentMethods.acceptsQris && (
                <div className="space-y-4 pt-2">
                  <input
                    ref={qrisFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleQrisUpload}
                  />

                  {paymentMethods.qrisImageUrl ? (
                    <div className="inline-block">
                      <img
                        src={paymentMethods.qrisImageUrl}
                        alt="QRIS"
                        className="max-w-[200px] h-auto rounded-lg border border-line dark:border-dline"
                      />
                      <div className="mt-2">
                        <button
                          onClick={() => qrisFileInputRef.current?.click()}
                          disabled={qrisUploadLoading}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-muted hover:text-brand hover:bg-brand-soft dark:hover:bg-brand/15 rounded-lg transition"
                        >
                          {qrisUploadLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                          Ubah QRIS
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`border-2 border-dashed border-line dark:border-dline rounded-lg p-6 text-center cursor-pointer hover:bg-surface dark:hover:bg-dline transition ${qrisUploadLoading ? 'opacity-50 pointer-events-none' : ''}`}
                      onClick={() => qrisFileInputRef.current?.click()}
                    >
                      <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
                      <p className="text-sm text-ink dark:text-surface">Upload QRIS</p>
                      <p className="text-xs text-muted mt-1">Klik untuk memilih gambar (max 3MB)</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. Pengiriman */}
          <div ref={shippingRef} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6">
            <SectionHeader
              icon={<Truck className="w-5 h-5 text-brand" />}
              title="Pengiriman"
              helper="Mode & ongkir"
              feedback={shippingFeedback}
              saveDisabled={!shippingDirty}
              onSave={handleSaveShipping}
              saving={savingShipping}
              saveLabel="Simpan"
              dirty={shippingDirty}
            />
            <div className="space-y-4">
              {shippingLoading ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-line animate-pulse" />
                    <div className="h-3 w-24 bg-line animate-pulse rounded" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-line animate-pulse" />
                    <div className="h-3 w-20 bg-line animate-pulse rounded" />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="shippingMode"
                    value="pickup"
                    checked={shippingMode === 'pickup'}
                    onChange={() => { setShippingMode('pickup'); setShippingDirty(true); }}
                    className="h-4 w-4 text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-medium text-ink dark:text-surface">Ambil di Toko</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="shippingMode"
                    value="flat"
                    checked={shippingMode === 'flat'}
                    onChange={() => { setShippingMode('flat'); setShippingDirty(true); }}
                    className="h-4 w-4 text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-medium text-ink dark:text-surface">Ongkir Flat</span>
                </label>
                </div>
              )}

              {shippingMode === 'flat' && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-ink dark:text-surface">Ongkir Dalam Kota</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-sm text-muted">Rp</span>
                      <input
                        type="number"
                        min="0"
                        value={shippingFlatInCity === '' ? '' : shippingFlatInCity}
                        onChange={(e) => { setShippingFlatInCity(e.target.value ? Number(e.target.value) : ''); setShippingDirty(true); }}
                        placeholder="0"
                        className="w-full pl-12 pr-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-ink dark:text-surface">Ongkir Luar Kota</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-sm text-muted">Rp</span>
                      <input
                        type="number"
                        min="0"
                        value={shippingFlatOutCity === '' ? '' : shippingFlatOutCity}
                        onChange={(e) => { setShippingFlatOutCity(e.target.value ? Number(e.target.value) : ''); setShippingDirty(true); }}
                        placeholder="0"
                        className="w-full pl-12 pr-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4. SOP — collapsible textareas */}
        <div ref={sopRef} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6">
          <SectionHeader
            icon={<BookOpen className="w-5 h-5 text-brand" />}
            title="Prosedur Penanganan Pesanan"
            helper="cara AI melayani pesanan pelanggan"
            feedback={sopFeedback}
            saveDisabled={!sopDirty}
            onSave={handleSaveAllSop}
            saving={savingSop}
            saveLabel="Simpan"
            dirty={sopDirty}
          />

          {sopLoadError && (
            <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Gagal memuat data SOP tersimpan. JANGAN simpan sebelum reload, bisa menimpa data lama.</span>
            </div>
          )}

          {sopLoadError && (
            <div className="mb-4">
              <button
                onClick={fetchSops}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-deep"
              >
                <RefreshCw className="w-3 h-3" />
                Coba Lagi
              </button>
            </div>
          )}

          <div className={sopLoadError ? 'pointer-events-none opacity-50' : 'space-y-3'}>
            {[
              { cat: 'order', label: 'Prosedur Penanganan Pesanan' },
              { cat: 'komplain', label: 'Komplain' },
              { cat: 'retur', label: 'Retur' },
              { cat: 'garansi', label: 'Garansi' },
              { cat: 'stok_habis', label: 'Stok Habis' },
            ].map(({ cat, label }) => {
              const expanded = expandedSop[cat] ?? false;
              const catFeedback = sopCatFeedback[cat];
              const catSaving = sopSavingMap[cat] ?? false;
              const catDirty = sopDirtyMap[cat] ?? false;
              return (
                <div key={cat} className="border border-line dark:border-dline rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSop((m) => ({ ...m, [cat]: !expanded }))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink dark:text-surface hover:bg-surface dark:hover:bg-dline transition"
                  >
                    <span>{label}</span>
                    <ChevronDown className={`w-4 h-4 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    <div className="p-4 border-t border-line dark:border-dline space-y-3">
                      <textarea
                        value={sopLoadError ? '' : (sopData[cat] ?? '')}
                        onChange={(e) => {
                          if (sopLoadError) return;
                          const v = e.target.value;
                          setSopData((prev) => ({ ...prev, [cat]: v }));
                          setSopDirty(true);
                          setSopDirtyMap((m) => ({ ...m, [cat]: true }));
                        }}
                        disabled={sopLoadError}
                        placeholder={sopLoadError ? 'Data SOP gagal dimuat — silakan refresh' : `Tuliskan prosedur ${label.toLowerCase()} di sini...`}
                        rows={4}
                        className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand resize-y disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="flex justify-end gap-2">
                        {catFeedback && (
                          <span className={`text-xs font-medium ${
                            catFeedback.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>
                            {catFeedback.type === 'success' ? '✓ ' : '✕ '}{catFeedback.msg}
                          </span>
                        )}
                        <button
                          onClick={() => handleSaveSopCategory(cat)}
                          disabled={catSaving || !catDirty}
                          className="flex items-center justify-center gap-1.5 bg-brand text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-brand-deep focus-visible:ring-2 focus:ring-brand disabled:bg-brand/30 transition"
                        >
                          {catSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Simpan
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 5. Keamanan */}
        <div ref={securityRef} className="bg-surface dark:bg-dcard rounded-2xl border border-line dark:border-dline p-6">
          <SectionHeader
            icon={<Lock className="w-5 h-5 text-brand" />}
            title="Keamanan"
            helper="Ganti password akun"
            feedback={pwFeedback}
            saveDisabled={!pwForm.currentPassword || !pwForm.newPassword || pwForm.newPassword !== pwForm.confirmPassword}
            onSave={handleChangePassword}
            saving={changingPassword}
            saveLabel={changingPassword ? 'Mengubah...' : 'Ubah Password'}
            dirty={false}
          />
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink dark:text-surface">Password Saat Ini <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                disabled={changingPassword}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink dark:text-surface">Password Baru <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                disabled={changingPassword}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink dark:text-surface">Konfirmasi Password Baru <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={pwForm.confirmPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                disabled={changingPassword}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-line dark:border-dline rounded-lg text-sm bg-surface dark:bg-dsurface text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ConfirmDialog for bank deletion */}
      {bankDeleteConfirm && (
        <ConfirmDialog
          message={`Hapus rekening bank "${bankDeleteConfirm.bankName}"?`}
          onConfirm={confirmDeleteBank}
          onCancel={() => setBankDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
