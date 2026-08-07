import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Shield, LogOut, LayoutDashboard, Store, Settings, ClipboardList, Archive, Smartphone, Package, Menu, X, Info, Loader2, BarChart3 } from 'lucide-react';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import adminApi from '../../services/adminApi';

const navItems = [
  { label: 'Overview', path: '/admin', icon: LayoutDashboard },
  { label: 'Stores', path: '/admin/stores', icon: Store },
  { label: 'Products', path: '/admin/products', icon: Package },
  { label: 'GOWA', path: '/admin/gowa', icon: Smartphone },
  { label: 'Config', path: '/admin/config', icon: Settings },
  { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
  { label: 'Audit Log', path: '/admin/audit-logs', icon: ClipboardList },
  { label: 'Backups', path: '/admin/backups', icon: Archive },
];

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ email: string; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string } | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  // Force dark mode ON for admin pages
  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => document.documentElement.classList.remove('dark');
  }, []);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  const fetchSessionInfo = async () => {
    setSessionLoading(true);
    try {
      const res = await adminApi.get('/auth/me');
      setSessionInfo(res.data.data);
    } catch {}
    setSessionLoading(false);
  };

  const handleNav = (path: string) => {
    navigate(path);
  };

  const isSuperAdmin = admin?.role === 'super_admin';
  const initials = (admin?.email || '?').charAt(0).toUpperCase();

  const sidebar = (
    <aside className="w-64 bg-dcard flex flex-col shrink-0 h-full border-r border-dline">
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-dline">
        <Shield className="w-5 h-5 text-cyan" />
        <span className="font-display font-semibold text-xl text-surface">MISSION CONTROL</span>
      </div>

      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = item.path === '/admin'
            ? location.pathname === '/admin'
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                active
                  ? 'bg-dline/30 text-cyan'
                  : 'text-slate-400 hover:bg-dline/20 hover:text-surface'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-dline">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-xs font-semibold shrink-0 text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-surface truncate">{admin?.email}</p>
            <p className="text-xs text-slate-400 capitalize">{admin?.role?.replace('_', ' ')}</p>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-navy flex">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">{sidebar}</div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 w-64 lg:hidden">
            {sidebar}
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="h-14 bg-navy/80 border-b border-dline flex items-center justify-between px-4 lg:px-6 shrink-0 sticky top-0 z-20 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-slate-400 hover:text-surface shrink-0"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="text-sm text-slate-400 truncate">
              {navItems.find((n) => location.pathname === n.path || (n.path !== '/admin' && location.pathname.startsWith(n.path)))?.label || 'Admin'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className={`px-2 py-0.5 rounded text-xs font-medium font-mono ${
                isSuperAdmin ? 'text-cyan bg-cyan/10' : 'text-slate-400 bg-dline/20'
              }`}>
                {admin?.role?.replace('_', ' ')}
              </span>
            </div>

            <button
              onClick={() => { setShowSessionInfo(true); fetchSessionInfo(); }}
              className="p-1.5 text-slate-400 hover:text-surface hover:bg-dline/20 rounded-lg transition"
              title="Info sesi"
            >
              <Info className="w-4 h-4" />
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-slate-400 hover:text-red-500 transition text-sm"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
      </header>

      {/* ─── Session Info Modal ─── */}
      {showSessionInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-dcard shadow-xl border border-dline">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dline">
              <h2 className="font-display font-semibold text-surface">Session Info</h2>
              <button
                onClick={() => setShowSessionInfo(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-dline/20 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {sessionLoading ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memuat...
                </div>
              ) : sessionInfo ? (
                <>
                  <div>
                    <span className="text-slate-400">Email:</span>
                    <span className="ml-2 font-medium text-surface">{sessionInfo.email}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Role:</span>
                    <span className={`ml-2 font-medium font-mono ${
                      sessionInfo.role === 'super_admin' ? 'text-cyan' : 'text-slate-400'
                    }`}>
                      {sessionInfo.role.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Aktif:</span>
                    <span className={`ml-2 ${sessionInfo.isActive ? 'text-cyan' : 'text-red-500'}`}>
                      {sessionInfo.isActive ? 'Ya' : 'Tidak'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Last Login:</span>
                    <span className="ml-2 text-slate-300">
                      {sessionInfo.lastLoginAt ? new Date(sessionInfo.lastLoginAt).toLocaleString('id-ID') : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Akun Dibuat:</span>
                    <span className="ml-2 text-slate-300">
                      {new Date(sessionInfo.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-slate-400">Gagal memuat info sesi.</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-dline bg-dline/20 rounded-b-xl">
              <button
                onClick={() => setShowSessionInfo(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-400 hover:bg-dline/30 rounded-lg transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
