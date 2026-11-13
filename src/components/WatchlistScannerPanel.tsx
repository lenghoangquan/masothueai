import React, { useState, useEffect } from 'react';
import {
  Play,
  MailWarning,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Radar,
  Lock,
  Clock,
  CalendarDays,
  MailCheck,
  BellRing,
} from 'lucide-react';
import {
  WatchlistEntry,
  runDaily0630BatchScan,
  lookupEnterpriseRisk,
  LegalStatus,
  SchemaRiskLevel,
} from '../utils/taxEngine';

interface WatchlistScannerPanelProps {
  isAuthenticated: boolean;
  userEmail: string;
  watchlist: WatchlistEntry[];
  onGoogleSignIn: () => void;
  onSimulateStatusChange: (
    itemId: string,
    newStatus: LegalStatus,
    newRiskLevel: SchemaRiskLevel,
    newReason: string
  ) => Promise<void>;
  onRemoveWatchlistItem: (itemId: string) => Promise<void>;
}

type AlertFrequency = 'DAILY' | 'WEEKLY';

const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: 'MONDAY', label: 'Thứ Hai' },
  { value: 'TUESDAY', label: 'Thứ Ba' },
  { value: 'WEDNESDAY', label: 'Thứ Tư' },
  { value: 'THURSDAY', label: 'Thứ Năm' },
  { value: 'FRIDAY', label: 'Thứ Sáu' },
  { value: 'SATURDAY', label: 'Thứ Bảy' },
  { value: 'SUNDAY', label: 'Chủ Nhật' },
];

export const WatchlistScannerPanel: React.FC<WatchlistScannerPanelProps> = ({
  isAuthenticated,
  userEmail,
  watchlist,
  onGoogleSignIn,
  onSimulateStatusChange,
  onRemoveWatchlistItem,
}) => {
  const [scanDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [scanningBatch, setScanningBatch] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(100);
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);
  const [scanTriggeredToast, setScanTriggeredToast] = useState<string | null>(null);

  // Automatic Email Alert Schedule Settings
  const [alertFrequency, setAlertFrequency] = useState<AlertFrequency>('DAILY');
  const [alertWeekday, setAlertWeekday] = useState<string>('MONDAY');
  const [alertTime, setAlertTime] = useState<string>('06:30');
  const [onlyHighRisk, setOnlyHighRisk] = useState<boolean>(true);
  const [scheduleSavedToast, setScheduleSavedToast] = useState<string | null>(null);

  const activeLoginEmail = userEmail || 'Chưa xác định email đăng nhập';

  useEffect(() => {
    try {
      const storageKey = `taxguard_alert_schedule_${userEmail || 'default'}`;
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.frequency === 'DAILY' || parsed.frequency === 'WEEKLY') {
          setAlertFrequency(parsed.frequency);
        }
        if (parsed.weekday) {
          setAlertWeekday(parsed.weekday);
        }
        if (parsed.time && /^[0-9]{2}:[0-9]{2}$/.test(parsed.time)) {
          setAlertTime(parsed.time);
        }
        if (typeof parsed.onlyHighRisk === 'boolean') {
          setOnlyHighRisk(parsed.onlyHighRisk);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, [userEmail]);

  const handleSaveAlertSchedule = () => {
    try {
      const storageKey = `taxguard_alert_schedule_${userEmail || 'default'}`;
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          frequency: alertFrequency,
          weekday: alertWeekday,
          time: alertTime,
          onlyHighRisk,
          recipientEmail: activeLoginEmail,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage errors
    }

    const weekdayLabel =
      WEEKDAY_OPTIONS.find((w) => w.value === alertWeekday)?.label || 'Thứ Hai';
    const freqDescription =
      alertFrequency === 'DAILY'
        ? `Hàng ngày lúc ${alertTime}`
        : `Hàng tuần (${weekdayLabel}) lúc ${alertTime}`;

    setScheduleSavedToast(
      `Đã lưu cài đặt cảnh báo tự động: Quét định kỳ ${freqDescription} · Tự động gửi Email về địa chỉ đăng nhập (${activeLoginEmail}) ngay khi phát hiện Người nộp thuế ở mức Rủi ro cao.`
    );
  };

  if (!isAuthenticated) {
    return (
      <section
        data-testid="module-4-auth-gate"
        className="futuristic-surface rounded-3xl p-8 sm:p-12 text-center max-w-2xl mx-auto my-6 space-y-5 border border-blue-200"
      >
        <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8 text-blue-600" />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-mono font-extrabold text-blue-600">
            YÊU CẦU ĐĂNG NHẬP GOOGLE
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Danh sách theo dõi
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto">
            Chức năng quản lý Danh sách theo dõi nhà cung cấp và cài đặt lịch gửi cảnh báo tự động qua Email yêu cầu bạn{' '}
            <strong>đăng nhập qua tài khoản Google</strong> để thực hiện.
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <button
            type="button"
            data-testid="module-4-google-login-btn"
            onClick={onGoogleSignIn}
            className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
          >
            Đăng nhập bằng tài khoản Google
          </button>
        </div>
      </section>
    );
  }

  const { payload, emailAlert } = runDaily0630BatchScan(activeLoginEmail, watchlist, scanDate);

  // Filter high-risk taxpayers in watchlist for email alert preview
  const highRiskEntries = watchlist.filter(
    (item) =>
      item.riskLevel === 'CRITICAL' ||
      item.riskLevel === 'HIGH' ||
      item.currentStatus !== 'Đang hoạt động'
  );

  const handleRunManualScan = async () => {
    setScanningBatch(true);
    setScanProgress(20);
    setScanTriggeredToast(null);

    await new Promise((r) => setTimeout(r, 150));
    setScanProgress(60);

    let serverRecords: Record<string, ReturnType<typeof lookupEnterpriseRisk>> = {};
    try {
      const res = await fetch('/api/tax/batch-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: watchlist.map((item) => item.mst) }),
      });
      if (res.ok) {
        const data = await res.json();
        serverRecords = data.records || {};
      }
    } catch {
      // Fallback to local lookup below
    }

    for (const item of watchlist) {
      const latestRecord = serverRecords[item.mst] || lookupEnterpriseRisk(item.mst);
      if (
        latestRecord.legalStatus !== item.currentStatus ||
        latestRecord.schemaRiskLevel !== item.riskLevel
      ) {
        await onSimulateStatusChange(
          item.id,
          latestRecord.legalStatus,
          latestRecord.schemaRiskLevel,
          latestRecord.riskReasons[0] || item.riskReason
        );
      }
    }

    await new Promise((r) => setTimeout(r, 150));
    setScanProgress(100);
    setScanningBatch(false);
    setScanTriggeredToast(
      `Đã hoàn tất kiểm tra chéo đa nguồn ${watchlist.length} doanh nghiệp trong Danh sách theo dõi · Phát hiện ${highRiskEntries.length} người nộp thuế ở mức rủi ro cao -> Sẵn sàng gửi cảnh báo tới ${activeLoginEmail}.`
    );
  };

  const handleCopyEmail = () => {
    if (!emailAlert) return;
    navigator.clipboard.writeText(emailAlert.bodyMarkdown);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const selectedWeekdayLabel =
    WEEKDAY_OPTIONS.find((w) => w.value === alertWeekday)?.label || 'Thứ Hai';

  return (
    <div className="space-y-6">
      {/* Header: Danh sách theo dõi */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Radar className={`w-7 h-7 text-blue-600 ${scanningBatch ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="text-sm sm:text-base font-mono text-blue-600 font-bold">
                GIÁM SÁT TỰ ĐỘNG · EMAIL NHẬN CẢNH BÁO: {activeLoginEmail}
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-0.5 tracking-tight">
                Danh sách theo dõi
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunManualScan}
            disabled={scanningBatch}
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-5 h-5" />
            <span>
              {scanningBatch ? 'Đang quét Danh sách theo dõi...' : 'Kích hoạt Phiên quét Ngay'}
            </span>
          </button>
        </div>

        {scanningBatch && (
          <div className="mt-5 space-y-2.5">
            <div className="flex items-center justify-between text-base font-mono text-blue-700 font-semibold">
              <span>
                Đang đối chiếu toàn bộ MST trong Danh sách theo dõi với CSDL Cơ quan Thuế...
              </span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-150"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {scanTriggeredToast && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-base font-semibold text-emerald-700">
          ✓ {scanTriggeredToast}
        </div>
      )}

      {/* Bảng Danh sách theo dõi (Có cột Địa chỉ, Bỏ cột Hóa đơn đã lưu, Bỏ Giả lập bỏ trốn) */}
      <section className="futuristic-surface rounded-3xl overflow-hidden">
        <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex items-center justify-between gap-4">
          <div className="text-lg sm:text-xl font-extrabold text-slate-900">
            Danh sách theo dõi ({watchlist.length} doanh nghiệp)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table
            data-testid="watchlist-table"
            className="w-full text-left border-collapse text-base sm:text-[17px]"
          >
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-sm sm:text-base font-bold text-slate-600">
                <th className="py-4 px-6">MST & Nhà cung cấp</th>
                <th className="py-4 px-6">Địa chỉ</th>
                <th className="py-4 px-6">Trạng thái gốc (Baseline)</th>
                <th className="py-4 px-6">Trạng thái hiện tại</th>
                <th className="py-4 px-6">Mức rủi ro</th>
                <th className="py-4 px-6 text-right">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60">
              {watchlist.map((item) => {
                const hasDelta = item.baselineStatus !== item.currentStatus;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/80">
                    <td className="py-4.5 px-6">
                      <div className="font-mono font-extrabold text-slate-900 tabular-nums">
                        {item.mst}
                      </div>
                      <div className="text-sm sm:text-base text-slate-700 mt-0.5 font-semibold">
                        {item.companyName}
                      </div>
                    </td>

                    <td className="py-4.5 px-6 text-slate-800">
                      <div className="font-medium leading-relaxed">{item.address || 'Việt Nam'}</div>
                      {item.taxAuthority && (
                        <div className="text-sm font-mono text-blue-600 font-semibold mt-0.5">
                          {item.taxAuthority}
                        </div>
                      )}
                    </td>

                    <td className="py-4.5 px-6 text-slate-700 font-medium">
                      [{item.baselineStatus}]
                    </td>

                    <td className="py-4.5 px-6">
                      <span
                        className={`font-bold ${
                          hasDelta || item.currentStatus !== 'Đang hoạt động'
                            ? 'text-rose-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        [{item.currentStatus}]
                      </span>
                    </td>

                    <td className="py-4.5 px-6 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-2 font-extrabold ${
                          item.riskLevel === 'CRITICAL'
                            ? 'text-rose-600'
                            : item.riskLevel === 'HIGH' || item.riskLevel === 'WARNING'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {item.riskLevel === 'CRITICAL' ? (
                          <ShieldAlert className="w-5 h-5" />
                        ) : item.riskLevel === 'HIGH' || item.riskLevel === 'WARNING' ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : (
                          <ShieldCheck className="w-5 h-5" />
                        )}
                        <span>
                          {item.riskLevel === 'CRITICAL'
                            ? 'NGUY CƠ CAO'
                            : item.riskLevel === 'HIGH' || item.riskLevel === 'WARNING'
                            ? 'CẢNH BÁO'
                            : 'AN TOÀN'}
                        </span>
                      </span>
                    </td>

                    <td className="py-4.5 px-6 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onRemoveWatchlistItem(item.id)}
                        aria-label={`Xóa MST ${item.mst}`}
                        className="p-2 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phần Email Cảnh báo & Cài đặt Lịch Quét Tự động (Đã ẩn hoàn toàn Data Schema JSON) */}
      <section
        data-testid="email-alert-settings-section"
        className="futuristic-surface rounded-3xl p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-600 font-mono text-sm sm:text-base font-extrabold">
              <BellRing className="w-5 h-5" />
              <span>CÀI ĐẶT CẢNH BÁO EMAIL TỰ ĐỘNG</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
              Lịch Quét Tự động & Gửi Email Cảnh báo Rủi ro Cao
            </h2>
          </div>

          {emailAlert && (
            <button
              type="button"
              onClick={handleCopyEmail}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm sm:text-base font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl cursor-pointer shrink-0"
            >
              {copiedEmail ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Copy className="w-4 h-4 text-slate-500" />
              )}
              <span>{copiedEmail ? 'Đã chép Nội dung Email' : 'Copy Nội dung Email'}</span>
            </button>
          )}
        </div>

        {/* Khung Cấu hình Lịch Quét (Hàng ngày / Hàng tuần / Giờ quét / Email đăng nhập) */}
        <div className="p-6 rounded-2xl bg-blue-50/50 border border-blue-200/90 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 1. Chọn tần suất: Hàng ngày / Hàng tuần */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-slate-800">
                <CalendarDays className="w-5 h-5 text-blue-600" />
                <span>1. Chu kỳ quét tự động</span>
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-white border border-slate-200 rounded-xl">
                <button
                  type="button"
                  data-testid="freq-daily-btn"
                  onClick={() => setAlertFrequency('DAILY')}
                  className={`py-2.5 px-3 rounded-lg text-sm sm:text-base font-bold transition-colors cursor-pointer ${
                    alertFrequency === 'DAILY'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Hàng ngày
                </button>
                <button
                  type="button"
                  data-testid="freq-weekly-btn"
                  onClick={() => setAlertFrequency('WEEKLY')}
                  className={`py-2.5 px-3 rounded-lg text-sm sm:text-base font-bold transition-colors cursor-pointer ${
                    alertFrequency === 'WEEKLY'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Hàng tuần
                </button>
              </div>

              {alertFrequency === 'WEEKLY' && (
                <div className="pt-2">
                  <select
                    aria-label="Chọn ngày trong tuần"
                    data-testid="weekday-select"
                    value={alertWeekday}
                    onChange={(e) => setAlertWeekday(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-base font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {WEEKDAY_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>
                        Quét vào {w.label} hàng tuần
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 2. Chọn giờ quét */}
            <div className="space-y-2">
              <label
                htmlFor="alert-time-input"
                className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-slate-800"
              >
                <Clock className="w-5 h-5 text-blue-600" />
                <span>2. Giờ quét & gửi Email (GMT+7)</span>
              </label>
              <input
                id="alert-time-input"
                data-testid="alert-time-input"
                type="time"
                value={alertTime}
                onChange={(e) => setAlertTime(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-xl text-base sm:text-lg font-mono font-extrabold text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {['06:30', '08:00', '12:00', '17:30'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAlertTime(preset)}
                    className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border cursor-pointer transition-colors ${
                      alertTime === preset
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Email nhận cảnh báo (Cố định theo email đăng nhập) */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-slate-800">
                <MailCheck className="w-5 h-5 text-emerald-600" />
                <span>3. Email nhận cảnh báo tự động</span>
              </label>
              <div
                data-testid="alert-recipient-email"
                className="px-4 py-3 bg-white border border-emerald-300 rounded-xl font-mono text-base font-bold text-emerald-800 break-all"
              >
                {activeLoginEmail}
              </div>
              <div className="text-xs sm:text-sm text-slate-600">
                Tự động gửi về chính tài khoản Google đang đăng nhập khi phát hiện NNT ở mức <strong>Rủi ro cao</strong>.
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-blue-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2.5 text-sm sm:text-base font-semibold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyHighRisk}
                onChange={(e) => setOnlyHighRisk(e.target.checked)}
                className="w-5 h-5 accent-blue-600 rounded cursor-pointer"
              />
              <span>
                Chỉ tự động gửi Email khi phát hiện Người nộp thuế ở mức <strong className="text-rose-600">Rủi ro cao (Nguy cơ cao / Bỏ trốn / Ngừng hoạt động)</strong>
              </span>
            </label>

            <button
              type="button"
              data-testid="save-alert-schedule-btn"
              onClick={handleSaveAlertSchedule}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer shrink-0"
            >
              Lưu Cài đặt Cảnh báo Tự động
            </button>
          </div>

          {scheduleSavedToast && (
            <div
              data-testid="schedule-saved-banner"
              className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm sm:text-base font-semibold text-emerald-800"
            >
              ✓ {scheduleSavedToast}
            </div>
          )}
        </div>

        {/* Nội dung Email Cảnh báo Khẩn gửi về Email đăng nhập */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-base sm:text-lg font-extrabold text-slate-900">
              <MailWarning className="w-5 h-5 text-rose-600" />
              <span>
                Nội dung Email Cảnh báo Rủi ro Cao ({payload.changes.length} doanh nghiệp phát hiện)
              </span>
            </div>
            <div className="text-sm sm:text-base text-slate-600 font-medium">
              Lịch gửi:{' '}
              <strong className="text-slate-900">
                {alertFrequency === 'DAILY'
                  ? `Hàng ngày lúc ${alertTime}`
                  : `Hàng tuần (${selectedWeekdayLabel}) lúc ${alertTime}`}
              </strong>{' '}
              → <span className="font-mono font-bold text-blue-700">{activeLoginEmail}</span>
            </div>
          </div>

          {emailAlert && highRiskEntries.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {highRiskEntries.map((item) => (
                <div
                  key={item.id}
                  className="p-6 rounded-2xl futuristic-card-inner space-y-3 text-base border border-rose-200/80"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-slate-900 text-lg">{item.companyName}</span>
                    <span className="font-mono font-extrabold text-rose-600 shrink-0">
                      [{item.riskLevel === 'CRITICAL' ? 'RỦI RO CAO' : 'CẢNH BÁO'}]
                    </span>
                  </div>
                  <div className="font-mono text-slate-700 font-semibold">MST: {item.mst}</div>
                  <div className="text-slate-700">
                    <strong className="text-slate-900">Địa chỉ:</strong> {item.address || 'Việt Nam'}
                  </div>
                  <div className="text-rose-600 font-bold">
                    Biến động trạng thái: {item.baselineStatus} → {item.currentStatus}
                  </div>
                  <div className="pt-3 border-t border-slate-200 text-slate-700 leading-relaxed">
                    <strong className="text-slate-900">Căn cứ & Khuyến nghị:</strong> {item.riskReason}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-base text-slate-500">
              Hiện không có người nộp thuế nào ở mức rủi ro cao trong Danh sách theo dõi.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
