import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut, User, LayoutDashboard, Inbox, Package, BarChart3,
  MessageSquare, BookOpen, Bot, Phone, UserCircle,
  Menu, X, Sun, Moon, Bell, CircleDollarSign,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import QloBotMark from './QloBotMark';

// ── NAV GROUPS ──
const navGroups: Array<{ label: string; items: Array<{ label: string; path: string; icon: React.ElementType }> }> = [
  {
    label: 'Utama',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { label: 'Inbox', path: '/dashboard/conversations', icon: Inbox },
      { label: 'Orders', path: '/dashboard/orders', icon: Package },
      { label: 'Verifikasi Pembayaran', path: '/dashboard/payment-verification', icon: CircleDollarSign },
      { label: 'Products', path: '/dashboard/products', icon: Package },
    ],
  },
  {
    label: 'Pelanggan & AI',
    items: [
      { label: 'Analytics', path: '/dashboard/analytics', icon: BarChart3 },
      { label: 'FAQ Manager', path: '/dashboard/faq', icon: MessageSquare },
      { label: 'Knowledge Base', path: '/dashboard/knowledge', icon: BookOpen },
      { label: 'AI Settings', path: '/dashboard/ai-settings', icon: Bot },
    ],
  },
  {
    label: 'Pengaturan',
    items: [
      { label: 'WhatsApp', path: '/dashboard/whatsapp', icon: Phone },
      { label: 'Profile', path: '/dashboard/profile', icon: UserCircle },
    ],
  },
];

// ── QLOBOT BRAND MARK ──
// (now imported from components/QloBotMark)


export default function DashboardLayout() {
  const { user, updateUserProfile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() =>
    localStorage.getItem('qlobot_theme') === 'dark'
  );
  const [waConnected, setWaConnected] = useState(false);
  const [waPhoneNumber, setWaPhoneNumber] = useState<string | null>(null);
  const [humanCount, setHumanCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);

  const ORDER_PENDING = ['pending', 'waiting_payment', 'waiting_address', 'draft'];

  // ── Sync header name/avatar with latest saved profile ──
  useEffect(() => {
    api.get('/profile')
      .then((res) => {
        const d = res.data.data;
        updateUserProfile({ storeName: d.name, profilePhotoUrl: d.profilePhotoUrl });
      })
      .catch(() => {});
  }, [updateUserProfile]);

  // ── Dark mode ──
  useEffect(() => {
    const html = document.documentElement;
    if (dark) {
      html.classList.add('dark');
      localStorage.setItem('qlobot_theme', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('qlobot_theme', 'light');
    }
  }, [dark]);

  // ── Fetch WhatsApp status + counts on mount ──
  useEffect(() => {
    Promise.allSettled([
      api.get('/whatsapp/fonnte/status'),
      api.get('/conversations'),
      api.get('/orders'),
      api.get('/products/my'),
    ]).then(([wa, conv, ord, prod]) => {
if (wa.status === 'fulfilled') {
        const d = wa.value.data?.data || {};
        setWaConnected(d.status === 'connected');
        setWaPhoneNumber(d.phoneNumber || d.fonnteNumber || null);
      }
      if (conv.status === 'fulfilled') {
        const list = conv.value.data?.data ?? [];
        setHumanCount(list.filter((c: { status: string }) => c.status === 'human_takeover').length);
      }
      if (ord.status === 'fulfilled') {
        const list = ord.value.data?.data ?? [];
        setPendingCount(list.filter((o: { orderStatus: string }) => ORDER_PENDING.includes(o.orderStatus)).length);
      }
      if (prod.status === 'fulfilled') {
        const list = prod.value.data?.products ?? [];
        setLowStockCount(list.filter((p: { stock: number | null }) => p.stock !== null && p.stock <= 5).length);
      }
    });
  }, []);

  // ── Close notification dropdown on route change ──
  useEffect(() => {
    setNotificationOpen(false);
  }, [location.pathname]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.notification-dropdown')) {
        setNotificationOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Close sidebar on navigation (mobile) ──
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleNav = (path: string) => {
    if (path !== '#') navigate(path);
  };

  const initials = (user?.storeName || user?.email || '?').trim().charAt(0).toUpperCase();

  // ── Notification count (total pending items across categories) ──
  const notificationCount =
    humanCount + pendingCount + lowStockCount;

  const currentPageLabel =
    navGroups.flatMap((g) => g.items).find((n) => location.pathname === n.path)?.label || 'Dashboard';

  const sidebar = (
    <aside className="w-64 xl:w-72 bg-surface dark:bg-dcard border-r border-line dark:border-dline flex flex-col shrink-0 h-full">
      {/* Brand */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-line dark:border-dline">
        <QloBotMark className="w-5 h-5 text-brand" />
        <span className="font-display font-bold text-navy dark:text-surface text-xl">QloBot</span>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-3 px-3 space-y-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <span className="px-3 text-xs font-semibold text-muted uppercase tracking-wider">
              {group.label}
            </span>
            <div className="mt-1.5 space-y-0.5">
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNav(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      active
                        ? 'bg-brand text-white'
                        : 'text-muted hover:bg-brand-soft hover:text-brand-deep dark:text-slate-300 dark:hover:bg-dline'
                    }`}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-line dark:border-dline">
        <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted truncate">
          <User className="w-4 h-4 shrink-0" />
          <span className="truncate">{user?.email}</span>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-surface dark:bg-dsurface flex">
      <div className="hidden lg:flex">{sidebar}</div>

      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 w-64 xl:w-72 lg:hidden animate-slide-in">
            {sidebar}
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="h-14 bg-white dark:bg-dcard border-b border-line dark:border-dline flex items-center justify-between px-4 lg:px-6 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand rounded shrink-0"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="hidden sm:block text-sm text-muted truncate">
              {currentPageLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 lg:gap-3 text-sm shrink-0">
            {/* Notification bell — satu pusat notifikasi, satu badge */}
            <div className="relative notification-dropdown">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNotificationOpen(!notificationOpen);
                }}
                className="relative w-9 h-9 rounded-lg text-muted hover:text-ink hover:bg-gray-100 dark:hover:bg-dline focus-visible:ring-2 focus-visible:ring-brand flex items-center justify-center transition"
                aria-label="Notifikasi"
              >
                <Bell className="w-4 h-4" />
                {notificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-bold grid place-items-center">
                    {notificationCount}
                  </span>
                )}
              </button>

              {/* Dropdown */}
              {notificationOpen && (
                <div className="fixed inset-x-4 top-[60px] z-50 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-72 bg-white dark:bg-dcard border border-line dark:border-dline rounded-xl shadow-lg p-2 space-y-1">
  {notificationCount === 0 ? (
                    <>
                      {/* WhatsApp channel status — always visible */}
                      <button
                        onClick={() => {
                          setNotificationOpen(false);
                          navigate('/dashboard/whatsapp');
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-dline text-left transition"
                      >
                        {waConnected
                          ? `WhatsApp: Terhubung • ${waPhoneNumber || '-'}`
                          : 'WhatsApp: Terputus — hubungkan'}
                      </button>
                      <div className="px-3 py-2 text-sm text-muted dark:text-slate-400 text-center">
                        Semua beres 🎉
                      </div>
                    </>
                  ) : (
                    <>
{/* WhatsApp channel status — always visible, single sumber status WA */}
                      <button
                        onClick={() => {
                          setNotificationOpen(false);
                          navigate('/dashboard/whatsapp');
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-dline text-left transition"
                      >
                        {waConnected
                          ? `WhatsApp: Terhubung • ${waPhoneNumber || '-'}`
                          : 'WhatsApp: Terputus — hubungkan'}
                      </button>
                      {humanCount > 0 && (
                        <button
                          onClick={() => {
                            setNotificationOpen(false);
                            navigate('/dashboard/conversations');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-dline text-left transition"
                        >
                          {humanCount} chat diambil alih
                        </button>
                      )}
                      {pendingCount > 0 && (
                        <button
                          onClick={() => {
                            setNotificationOpen(false);
                            navigate('/dashboard/orders');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-dline text-left transition"
                        >
                          {pendingCount} pesanan perlu proses
                        </button>
                      )}
                      {lowStockCount > 0 && (
                        <button
                          onClick={() => {
                            setNotificationOpen(false);
                            navigate('/dashboard/products');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-dline text-left transition"
                        >
                          {lowStockCount} stok menipis
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Dark mode toggle */}
            <button
              onClick={() => setDark(!dark)}
              className="p-1.5 text-muted hover:text-ink hover:bg-brand-soft dark:hover:bg-dline rounded-lg transition"
              aria-label="Ganti tema"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* User avatar */}
            <div className="flex items-center gap-2 text-ink min-w-0">
              {user?.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-line shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-brand-soft text-brand flex items-center justify-center text-xs font-semibold shrink-0">
                  {initials}
                </div>
              )}
              <span className="hidden sm:inline font-medium truncate max-w-[140px]">
                {user?.storeName || user?.email}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-muted hover:text-red-600 focus-visible:ring-2 focus-visible:ring-brand rounded shrink-0 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
