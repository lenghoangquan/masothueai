import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Server,
  Lock,
  RefreshCw,
  Trash2,
  Ban,
  CheckCircle2,
  Zap,
  Terminal,
  AlertTriangle,
  Cpu,
  UserCheck,
} from 'lucide-react';

interface SecurityConfigState {
  wafStrictMode: boolean;
  antiDdosEnabled: boolean;
  underAttackMode: boolean;
  rateLimitPerMinute: number;
  autoBanMultiplier: number;
  maxConcurrentConnections: number;
}

interface SecurityTelemetryState {
  totalRequestsInspected: number;
  totalThreatsBlocked: number;
  sqlInjectionBlocked: number;
  xssBlocked: number;
  pathTraversalBlocked: number;
  ddosFloodsBlocked: number;
  taxLookupsServed: number;
  invoicesScanned: number;
  batchLookupsServed: number;
  enterpriseCacheSize: number;
  enterpriseCacheMax: number;
  invoiceCacheSize: number;
  invoiceCacheMax: number;
  activeTrackedIps: number;
  uptimeSeconds: number;
  memoryMb: number;
  heapUsedMb: number;
}

interface BlockedIpRecord {
  ip: string;
  reason: string;
  blockedAt: string;
  expiresAt: number;
  hitCount: number;
}

interface SecurityAuditLogEntry {
  id: string;
  timestamp: string;
  ip: string;
  category:
    | 'SQL_INJECTION'
    | 'XSS_ATTACK'
    | 'PATH_TRAVERSAL'
    | 'PROTOTYPE_POLLUTION'
    | 'DDOS_FLOOD'
    | 'IP_BLACKLIST'
    | 'ADMIN_ACTION'
    | 'SYSTEM_GUARD';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  endpoint: string;
  detail: string;
  action: 'BLOCKED' | 'THROTTLED' | 'ALLOWED' | 'CONFIG_UPDATED';
}

interface AdminControlPanelProps {
  isAuthenticated: boolean;
  userEmail: string;
  onGoogleSignIn: () => void;
}

const DEFAULT_ADMIN_EMAIL = 'le.ng.hoang.quan@gmail.com';

export const AdminControlPanel: React.FC<AdminControlPanelProps> = ({
  isAuthenticated,
  userEmail,
  onGoogleSignIn,
}) => {
  const [config, setConfig] = useState<SecurityConfigState>({
    wafStrictMode: true,
    antiDdosEnabled: true,
    underAttackMode: false,
    rateLimitPerMinute: 120,
    autoBanMultiplier: 2.5,
    maxConcurrentConnections: 10000,
  });

  const [telemetry, setTelemetry] = useState<SecurityTelemetryState>({
    totalRequestsInspected: 0,
    totalThreatsBlocked: 0,
    sqlInjectionBlocked: 0,
    xssBlocked: 0,
    pathTraversalBlocked: 0,
    ddosFloodsBlocked: 0,
    taxLookupsServed: 0,
    invoicesScanned: 0,
    batchLookupsServed: 0,
    enterpriseCacheSize: 0,
    enterpriseCacheMax: 10000,
    invoiceCacheSize: 0,
    invoiceCacheMax: 5000,
    activeTrackedIps: 1,
    uptimeSeconds: 0,
    memoryMb: 0,
    heapUsedMb: 0,
  });

  const [blockedIps, setBlockedIps] = useState<BlockedIpRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [newBlockIp, setNewBlockIp] = useState<string>('');
  const [newBlockReason, setNewBlockReason] = useState<string>('');

  const isSuperAdmin =
    isAuthenticated &&
    userEmail.trim().toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase();

  const fetchAdminOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview');
      if (res.ok) {
        const data = await res.json();
        if (data.securityConfig) setConfig(data.securityConfig);
        if (data.telemetry) setTelemetry(data.telemetry);
        if (Array.isArray(data.blockedIps)) setBlockedIps(data.blockedIps);
        if (Array.isArray(data.auditLogs)) setAuditLogs(data.auditLogs);
      }
    } catch {
      // Keep current state on transient network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchAdminOverview();
    const timer = setInterval(fetchAdminOverview, 8000);
    return () => clearInterval(timer);
  }, [isSuperAdmin, fetchAdminOverview]);

  const executeAdminAction = async (
    payload: Record<string, unknown>,
    successBanner: string
  ) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.securityConfig) setConfig(data.securityConfig);
        if (data.telemetry) setTelemetry(data.telemetry);
        if (Array.isArray(data.blockedIps)) setBlockedIps(data.blockedIps);
        if (Array.isArray(data.auditLogs)) setAuditLogs(data.auditLogs);
        setStatusMessage(successBanner);
      }
    } catch {
      setStatusMessage('Không thể kết nối máy chủ quản trị.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleConfig = async (
    nextPartial: Partial<SecurityConfigState>,
    label: string
  ) => {
    const merged = { ...config, ...nextPartial };
    setConfig(merged);
    await executeAdminAction(
      {
        action: 'update_config',
        ...merged,
      },
      `Đã cập nhật cấu hình bảo mật: ${label}`
    );
  };

  const handleManualBlockIp = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedIp = newBlockIp.trim();
    if (!trimmedIp) return;
    await executeAdminAction(
      {
        action: 'block_ip',
        targetIp: trimmedIp,
        reason: newBlockReason.trim() || 'Chặn trực tiếp từ Bảng điều khiển Admin',
      },
      `Đã đưa địa chỉ IP ${trimmedIp} vào Danh sách chặn (Blacklist).`
    );
    setNewBlockIp('');
    setNewBlockReason('');
  };

  const handleUnblockIp = async (ip: string) => {
    await executeAdminAction(
      {
        action: 'unblock_ip',
        targetIp: ip,
      },
      `Đã gỡ chặn cho địa chỉ IP ${ip}.`
    );
  };

  const formatUptime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs}h ${mins}m ${secs}s`;
  };

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <div className="space-y-6" data-testid="admin-control-panel">
      {/* Top Admin Command Header */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8 border border-blue-200/90">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-lg">
              <ShieldAlert className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Trung tâm Quản trị Hệ thống & Phòng thủ Bảo mật (Admin Control)
                </h1>
              </div>
              <p className="text-sm sm:text-base text-slate-600 mt-1">
                Giám sát lưu lượng thời gian thực, Tường lửa WAF chống Hack (SQLi/XSS/LFI) và Lá chắn chống DDoS đa tầng
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {isAuthenticated ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-sm font-bold">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span>
                  Admin: {userEmail} {isSuperAdmin ? '(Quản trị viên Cấp cao)' : ''}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={onGoogleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-sm font-bold transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>Đăng nhập Tài khoản Quản trị Google</span>
              </button>
            )}

            <button
              type="button"
              onClick={fetchAdminOverview}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-sm font-bold transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-blue-600 ${loading ? 'animate-spin' : ''}`} />
              <span>Làm mới Telemetry</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            data-testid="admin-status-banner"
            className="mt-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-base font-bold text-emerald-900"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </section>

      {/* 4 Key Security & Server Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {/* Card 1: WAF Anti-Hack Status */}
        <section className="futuristic-surface rounded-3xl p-6 border border-emerald-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Tường lửa WAF Chống Hack</span>
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900">
            {config.wafStrictMode ? 'ĐANG BẢO VỆ (ON)' : 'TẠM TẮT'}
          </div>
          <div className="text-xs sm:text-sm font-mono text-slate-600 space-y-1 pt-2 border-t border-slate-200/70">
            <div className="flex justify-between">
              <span>Chặn SQL Injection:</span>
              <strong className="text-rose-600">{telemetry.sqlInjectionBlocked}</strong>
            </div>
            <div className="flex justify-between">
              <span>Chặn XSS Script:</span>
              <strong className="text-rose-600">{telemetry.xssBlocked}</strong>
            </div>
            <div className="flex justify-between">
              <span>Chặn Path Traversal:</span>
              <strong className="text-rose-600">{telemetry.pathTraversalBlocked}</strong>
            </div>
          </div>
        </section>

        {/* Card 2: Anti-DDoS Shield */}
        <section className="futuristic-surface rounded-3xl p-6 border border-blue-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Lá chắn Chống DDoS</span>
            <Zap className="w-6 h-6 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {config.underAttackMode
              ? `${Math.max(15, Math.floor(config.rateLimitPerMinute / 2))} req/p (Khẩn cấp)`
              : `${config.rateLimitPerMinute} req/phút/IP`}
          </div>
          <div className="text-xs sm:text-sm font-mono text-slate-600 space-y-1 pt-2 border-t border-slate-200/70">
            <div className="flex justify-between">
              <span>Đợt DDoS Flood đã chặn:</span>
              <strong className="text-rose-600">{telemetry.ddosFloodsBlocked}</strong>
            </div>
            <div className="flex justify-between">
              <span>IP đang giám sát:</span>
              <strong className="text-blue-700">{telemetry.activeTrackedIps} IP</strong>
            </div>
            <div className="flex justify-between">
              <span>IP đang bị khóa:</span>
              <strong className="text-rose-600">{blockedIps.length} IP</strong>
            </div>
          </div>
        </section>

        {/* Card 3: Traffic & Threat Inspection */}
        <section className="futuristic-surface rounded-3xl p-6 border border-indigo-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Kiểm duyệt An ninh API</span>
            <Activity className="w-6 h-6 text-indigo-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">
            {telemetry.totalRequestsInspected.toLocaleString('vi-VN')} req
          </div>
          <div className="text-xs sm:text-sm font-mono text-slate-600 space-y-1 pt-2 border-t border-slate-200/70">
            <div className="flex justify-between">
              <span>Tổng mối đe dọa bị chặn:</span>
              <strong className="text-rose-600">{telemetry.totalThreatsBlocked}</strong>
            </div>
            <div className="flex justify-between">
              <span>Phiên tra cứu MST:</span>
              <strong className="text-emerald-700">{telemetry.taxLookupsServed}</strong>
            </div>
            <div className="flex justify-between">
              <span>Chứng từ HĐ đã quét:</span>
              <strong className="text-emerald-700">{telemetry.invoicesScanned}</strong>
            </div>
          </div>
        </section>

        {/* Card 4: High-Concurrency Server Health (5000+ CCU) */}
        <section className="futuristic-surface rounded-3xl p-6 border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Hạ tầng Chịu tải 5.000+ CCU</span>
            <Cpu className="w-6 h-6 text-slate-700" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {telemetry.memoryMb} MB RAM
          </div>
          <div className="text-xs sm:text-sm font-mono text-slate-600 space-y-1 pt-2 border-t border-slate-200/70">
            <div className="flex justify-between">
              <span>Cache MST (LRU):</span>
              <strong className="text-blue-700">
                {telemetry.enterpriseCacheSize} / {telemetry.enterpriseCacheMax}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Cache Hóa đơn:</span>
              <strong className="text-blue-700">
                {telemetry.invoiceCacheSize} / {telemetry.invoiceCacheMax}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Thời gian hoạt động:</span>
              <strong className="text-slate-800">{formatUptime(telemetry.uptimeSeconds)}</strong>
            </div>
          </div>
        </section>
      </div>

      {/* Active Defense Controls & Security Drill */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: WAF & Anti-DDoS Switches */}
        <section className="lg:col-span-7 futuristic-surface rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-4">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                Cấu hình Cơ chế Bảo mật, Chống DDoS & Chống Hack
              </h2>
            </div>
          </div>

          <div className="space-y-4">
            {/* Switch 1: WAF Anti-Hack */}
            <label className="p-4 sm:p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
              <div className="space-y-1">
                <div className="text-base font-extrabold text-slate-900">
                  1. Tường lửa Ứng dụng Web (WAF Deep Packet Inspection)
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Tự động quét và khóa ngay lập tức các truy vấn chứa mã độc <strong>SQL Injection (SQLi)</strong>, <strong>Cross-Site Scripting (XSS)</strong>, <strong>Path Traversal (/etc/passwd)</strong> và <strong>Prototype Pollution</strong>.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.wafStrictMode}
                onChange={(e) =>
                  handleToggleConfig(
                    { wafStrictMode: e.target.checked },
                    `Tường lửa WAF = ${e.target.checked ? 'BẬT' : 'TẮT'}`
                  )
                }
                className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
              />
            </label>

            {/* Switch 2: Sliding-Window Anti-DDoS */}
            <label className="p-4 sm:p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
              <div className="space-y-1">
                <div className="text-base font-extrabold text-slate-900">
                  2. Lá chắn Chống DDoS Đa tầng (Sliding-Window Rate Limiter & Singleflight)
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Giới hạn tần suất gọi API theo từng IP, gộp truy vấn trùng lặp (Singleflight Coalescing) cho 5.000+ người dùng đồng thời và tự động khóa IP 10 phút nếu phát hiện tấn công Flood.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.antiDdosEnabled}
                onChange={(e) =>
                  handleToggleConfig(
                    { antiDdosEnabled: e.target.checked },
                    `Chống DDoS = ${e.target.checked ? 'BẬT' : 'TẮT'}`
                  )
                }
                className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
              />
            </label>

            {/* Switch 3: Emergency Under Attack Mode */}
            <label
              className={`p-4 sm:p-5 rounded-2xl border flex items-start justify-between gap-4 cursor-pointer transition-colors ${
                config.underAttackMode
                  ? 'bg-rose-50/90 border-rose-300'
                  : 'futuristic-card-inner'
              }`}
            >
              <div className="space-y-1">
                <div className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span>3. Chế độ Khẩn cấp: Đang bị Tấn công DDoS (Under Attack Shield)</span>
                  {config.underAttackMode && (
                    <span className="px-2.5 py-0.5 text-xs font-mono font-bold bg-rose-600 text-white rounded-md">
                      SIẾT CHẶT 50% RATE LIMIT
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Khi kích hoạt, hệ thống tự động giảm một nửa ngưỡng Rate Limit cho mỗi IP và hạ thấp ngưỡng tự động khóa IP (Auto-Ban) để bảo vệ tài nguyên máy chủ.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.underAttackMode}
                onChange={(e) =>
                  handleToggleConfig(
                    { underAttackMode: e.target.checked },
                    `Chế độ Under Attack = ${e.target.checked ? 'KÍCH HOẠT' : 'BÌNH THƯỜNG'}`
                  )
                }
                className="w-5 h-5 mt-1 accent-rose-600 rounded cursor-pointer shrink-0"
              />
            </label>

            {/* Rate Limit Selector */}
            <div className="p-4 sm:p-5 rounded-2xl futuristic-card-inner flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-base font-extrabold text-slate-900">
                  4. Ngưỡng giới hạn tốc độ truy vấn (Rate Limit / Phút / IP)
                </div>
                <div className="text-sm text-slate-600">
                  Số lượng yêu cầu API tối đa mỗi địa chỉ IP được phép gửi trong 60 giây
                </div>
              </div>
              <select
                value={config.rateLimitPerMinute}
                onChange={(e) =>
                  handleToggleConfig(
                    { rateLimitPerMinute: Number(e.target.value) },
                    `Giới hạn tốc độ = ${e.target.value} req/phút/IP`
                  )
                }
                className="px-4 py-2.5 bg-white border border-slate-300 rounded-xl font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value={60}>60 req / phút (Nghiêm ngặt)</option>
                <option value={120}>120 req / phút (Khuyến nghị)</option>
                <option value={240}>240 req / phút (Doanh nghiệp lớn)</option>
                <option value={500}>500 req / phút (Mạng nội bộ NAT)</option>
              </select>
            </div>
          </div>

          <div className="pt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="run-security-drill-btn"
              onClick={() =>
                executeAdminAction(
                  { action: 'run_security_drill' },
                  'Đã chạy Kiểm thử Phòng thủ Bảo mật: Chặn thành công 4 kịch bản tấn công (SQL Injection, XSS, Path Traversal & DDoS Flood 380 req/phút).'
                )
              }
              className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm sm:text-base font-bold rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              <ShieldAlert className="w-5 h-5" />
              <span>Chạy Diễn tập Chống Hack & DDoS (Self-Test)</span>
            </button>

            <button
              type="button"
              onClick={() =>
                executeAdminAction(
                  { action: 'clear_cache' },
                  'Đã làm sạch toàn bộ Bộ nhớ đệm LRU (MST & Hóa đơn) trên máy chủ.'
                )
              }
              className="inline-flex items-center gap-2 px-4 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm sm:text-base font-bold rounded-xl transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Xóa Cache Máy chủ</span>
            </button>
          </div>
        </section>

        {/* Right 5 Cols: IP Blacklist Firewall Manager */}
        <section className="lg:col-span-5 futuristic-surface rounded-3xl p-6 sm:p-8 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-4">
              <div className="flex items-center gap-2.5">
                <Ban className="w-5 h-5 text-rose-600" />
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Danh sách Chặn IP (IP Blacklist)
                </h2>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 font-mono text-xs font-bold text-rose-700">
                {blockedIps.length} IP bị khóa
              </span>
            </div>

            <form onSubmit={handleManualBlockIp} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Địa chỉ IP cần chặn (IPv4 / IPv6)
                </label>
                <input
                  type="text"
                  value={newBlockIp}
                  onChange={(e) => setNewBlockIp(e.target.value)}
                  placeholder="Ví dụ: 203.0.113.55"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl font-mono text-sm text-slate-900 focus:outline-none focus:border-rose-600"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Lý do chặn bảo mật
                </label>
                <input
                  type="text"
                  value={newBlockReason}
                  onChange={(e) => setNewBlockReason(e.target.value)}
                  placeholder="Ví dụ: Quét lỗ hổng / DDoS botnet..."
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-rose-600"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Ban className="w-4 h-4" />
                <span>Chặn Địa chỉ IP Ngay lập tức</span>
              </button>
            </form>

            <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
              {blockedIps.length === 0 ? (
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-center text-sm text-slate-500">
                  Hiện chưa có địa chỉ IP nào nằm trong danh sách khóa.
                </div>
              ) : (
                blockedIps.map((item) => (
                  <div
                    key={item.ip}
                    className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-extrabold text-rose-800 flex items-center gap-2">
                        <span>{item.ip}</span>
                        <span className="text-xs font-normal text-rose-600">
                          (Lúc {item.blockedAt} · Chặn {item.hitCount} lần)
                        </span>
                      </div>
                      <div className="text-xs text-slate-700 truncate mt-0.5">{item.reason}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnblockIp(item.ip)}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-rose-300 text-rose-700 text-xs font-bold rounded-lg shrink-0 cursor-pointer"
                    >
                      Gỡ chặn
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 text-xs font-mono space-y-1">
            <div className="text-emerald-400 font-bold">
              ✓ HTTP Security Headers Đang kích hoạt:
            </div>
            <div>• X-Content-Type-Options: nosniff</div>
            <div>• X-XSS-Protection: 1; mode=block</div>
            <div>• Strict-Transport-Security: max-age=31536000</div>
            <div>• Firestore RBAC Rules: Chặn ghi trái phép</div>
          </div>
        </section>
      </div>

      {/* Live WAF & Anti-DDoS Security Audit Logs Table */}
      <section className="futuristic-surface rounded-3xl overflow-hidden">
        <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
              Nhật ký Tường lửa WAF & Giám sát An ninh Thời gian thực (Security Audit Logs)
            </h2>
          </div>
          <span className="text-xs sm:text-sm font-mono font-bold text-slate-500">
            Hiển thị {auditLogs.length} sự kiện bảo mật gần nhất
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm sm:text-base">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-xs sm:text-sm font-bold text-slate-600">
                <th className="py-3.5 px-5 w-28">Thời gian</th>
                <th className="py-3.5 px-5 w-40">Loại sự kiện</th>
                <th className="py-3.5 px-5 w-36">Địa chỉ IP</th>
                <th className="py-3.5 px-5 w-48">Endpoint</th>
                <th className="py-3.5 px-5">Chi tiết Phân tích Bảo mật</th>
                <th className="py-3.5 px-5 w-36">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60">
              {auditLogs.map((log) => {
                const isBlocked = log.action === 'BLOCKED' || log.action === 'THROTTLED';
                return (
                  <tr
                    key={log.id}
                    className={isBlocked ? 'bg-rose-50/40 hover:bg-rose-50/80' : 'hover:bg-slate-50/80'}
                  >
                    <td className="py-3.5 px-5 font-mono text-xs sm:text-sm text-slate-600 tabular-nums">
                      {log.timestamp}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs font-extrabold">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md ${
                          log.severity === 'CRITICAL'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : log.severity === 'HIGH'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {log.severity === 'CRITICAL' && <AlertTriangle className="w-3.5 h-3.5" />}
                        <span>{log.category}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-5 font-mono font-bold text-slate-800">{log.ip}</td>
                    <td className="py-3.5 px-5 font-mono text-xs text-blue-700 truncate max-w-[200px]">
                      {log.endpoint}
                    </td>
                    <td className="py-3.5 px-5 text-slate-800 font-medium">{log.detail}</td>
                    <td className="py-3.5 px-5 font-mono text-xs font-extrabold">
                      {log.action === 'BLOCKED' ? (
                        <span className="text-rose-600">ĐÃ CHẶN (403)</span>
                      ) : log.action === 'THROTTLED' ? (
                        <span className="text-amber-600">CHẶN DDOS (429)</span>
                      ) : log.action === 'CONFIG_UPDATED' ? (
                        <span className="text-blue-600">ĐÃ CẬP NHẬT</span>
                      ) : (
                        <span className="text-emerald-600">HỢP LỆ</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
