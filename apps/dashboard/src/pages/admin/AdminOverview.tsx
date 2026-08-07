import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Shield, Archive, ArrowRight, Database, HardDrive, CheckCircle, XCircle, Smartphone } from 'lucide-react';
import { MetricCard } from '../../components/admin/MetricCard';
import { useMissionControl } from '../../hooks/useMissionControl';
import { usdToIdr, formatRupiahCompact } from '../../utils/formatMoney';

export default function AdminOverview() {
  const navigate = useNavigate();
  const { pulse, fetchPulse } = useMissionControl();

  useEffect(() => {
    fetchPulse().catch(() => {});
  }, [fetchPulse]);

  const statusBadge = (status: boolean) => {
    const label = status ? 'OK' : 'DOWN';
    if (status) {
      return (
        <span className="flex items-center gap-1 text-xs text-cyan font-medium">
          <CheckCircle className="w-3.5 h-3.5" /> {label}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
        <XCircle className="w-3.5 h-3.5" /> {label}
      </span>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-5 h-5 text-cyan" />
        <div>
          <h1 className="font-display text-2xl text-surface">MISSION CONTROL</h1>
          <p className="text-sm text-slate-400">Platform health & metrics</p>
        </div>
      </div>

      {/* System Health */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {pulse.loading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <MetricCard key={i} title="" value="" isLoading />
            ))}
          </>
        ) : pulse.data ? (
          <>
            <MetricCard
              title="Active Merchants"
              value={pulse.data.totalActiveMerchants.toLocaleString('id-ID')}
              icon={<Shield className="w-4 h-4" />}
            />
            <MetricCard
              title="Messages Today"
              value={pulse.data.totalMessagesToday.toLocaleString('id-ID')}
              icon={<Activity className="w-4 h-4" />}
            />
            <MetricCard
              title="AI Cost (today)"
              value={formatRupiahCompact(usdToIdr(pulse.data.aiCostToday))}
              icon={<Activity className="w-4 h-4" />}
            />
          </>
        ) : (
          <div className="col-span-full">
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
              <XCircle className="w-5 h-5" />
              <span>Gagal memuat data health</span>
            </div>
          </div>
        )}
      </div>

      {/* Database status detail */}
      {pulse.data && (
        <div className="bg-dcard border border-dline rounded-lg p-6">
          <h2 className="text-sm font-semibold text-surface mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-400" /> Dependencies
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-dline/20 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
pulse.data.systemHealth.db ? 'text-cyan' : 'text-red-500'
                }`}>
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface">Database</p>
{statusBadge(pulse.data.systemHealth.db)}
                </div>
              </div>
            </div>
            <div className="bg-dline/20 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  pulse.data.systemHealth.redis ? 'text-cyan' : 'text-red-500'
                }`}>
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface">Redis</p>
                  {statusBadge(pulse.data.systemHealth.redis)}
                </div>
              </div>
            </div>
            <div className="bg-dline/20 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  pulse.data.systemHealth.gowa ? 'text-cyan' : 'text-red-500'
                }`}>
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-surface">GOWA</p>
                  {statusBadge(pulse.data.systemHealth.gowa)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backup Status */}
      <div className="bg-dcard border border-dline rounded-lg p-6">
        <h2 className="text-sm font-semibold text-surface mb-4 flex items-center gap-2">
          <Archive className="w-4 h-4 text-slate-400" /> Backup Status
        </h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/backups')}
              className="text-sm text-cyan hover:text-cyan/80 font-medium flex items-center gap-1 cursor-pointer"
            >
              Manage <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
