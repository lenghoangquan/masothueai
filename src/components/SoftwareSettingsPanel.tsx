import React, { useState, useEffect } from 'react';
import {
  Settings,
  HeartHandshake,
  ShieldCheck,
  Search,
  FileCheck2,
  FileSpreadsheet,
  BellRing,
  CheckCircle2,
  RotateCcw,
  Users,
  Sparkles,
  Lock,
} from 'lucide-react';

interface SoftwareSettingsState {
  autoCrossCheck4Steps: boolean;
  defaultNativePdfViewer: boolean;
  autoPostMergerAddress: boolean;
  excelUtf16CsvExport: boolean;
}

const DEFAULT_SETTINGS: SoftwareSettingsState = {
  autoCrossCheck4Steps: true,
  defaultNativePdfViewer: true,
  autoPostMergerAddress: true,
  excelUtf16CsvExport: true,
};

const STORAGE_KEY = 'masothue_ai_software_settings_v1';

export const SoftwareSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<SoftwareSettingsState>(DEFAULT_SETTINGS);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings({
          autoCrossCheck4Steps: parsed.autoCrossCheck4Steps ?? true,
          defaultNativePdfViewer: parsed.defaultNativePdfViewer ?? true,
          autoPostMergerAddress: parsed.autoPostMergerAddress ?? true,
          excelUtf16CsvExport: parsed.excelUtf16CsvExport ?? true,
        });
      }
    } catch {
      // Keep default settings
    }
  }, []);

  const handleSaveSettings = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage error
    }
    setSavedNotice('Đã lưu cấu hình Cài đặt phần mềm thành công.');
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {
      // Ignore storage error
    }
    setSavedNotice('Đã khôi phục toàn bộ cài đặt phần mềm về mặc định chuẩn.');
    setTimeout(() => setSavedNotice(null), 4000);
  };

  return (
    <div className="space-y-6" data-testid="software-settings-panel">
      {/* Header Banner */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Settings className="w-7 h-7 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Cài đặt Phần mềm & Giới thiệu Hệ thống
              </h1>
              <p className="text-sm sm:text-base text-slate-600 mt-1">
                Thông tin tác dụng nghiệp vụ của phần mềm, sứ mệnh hoạt động vì cộng đồng và tùy chỉnh hệ thống
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm sm:text-base font-extrabold shrink-0">
            <HeartHandshake className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>Hoạt động 100% Vì Cộng đồng</span>
          </div>
        </div>
      </section>

      {/* Community Mission & Software Purpose Card */}
      <section
        data-testid="community-mission-section"
        className="futuristic-surface rounded-3xl p-6 sm:p-8 border border-blue-200/90 space-y-6"
      >
        <div className="p-6 sm:p-7 rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white shadow-lg shadow-blue-700/20 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/15 border border-white/25 text-xs sm:text-sm font-mono font-bold text-blue-50">
              <Users className="w-4 h-4" />
              <span>SỨ MỆNH PHỤNG SỰ CỘNG ĐỒNG KẾ TOÁN & DOANH NGHIỆP VIỆT NAM</span>
            </div>
            <span className="text-xs sm:text-sm font-mono font-bold text-emerald-200">
              MIỄN PHÍ · MINH BẠCH · BẢO MẬT
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold leading-snug">
            Phần mềm MASOTHUE AI được xây dựng và vận hành vì lợi ích chung của Cộng đồng
          </h2>

          <p className="text-base sm:text-[17px] text-blue-50 leading-relaxed">
            <strong>MASOTHUE AI</strong> là hệ thống đối soát tuân thủ thuế và kiểm soát rủi ro hóa đơn được phát triển nhằm <strong>hoạt động vì cộng đồng Kế toán, Kiểm toán, Đại lý thuế và Doanh nghiệp tại Việt Nam</strong>. Phần mềm giúp các doanh nghiệp vừa và nhỏ (SME), hộ kinh doanh và bộ phận kế toán tiết kiệm thời gian tra cứu thủ công, chủ động phòng ngừa rủi ro pháp lý về thuế và bảo vệ quyền lợi khấu trừ thuế GTGT hợp pháp trước các biến động trạng thái của nhà cung cấp.
          </p>
        </div>

        {/* 4 Core Software Utilities */}
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
            <h3 className="text-lg sm:text-xl font-extrabold text-slate-900">
              Tác dụng & Giá trị Thực tiễn của Phần mềm
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl futuristic-card-inner space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                  <Search className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="text-base sm:text-lg font-extrabold text-slate-900">
                  1. Tra cứu & Đối soát Chéo Mã số thuế
                </h4>
              </div>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Kiểm tra chính xác tình trạng pháp lý của người nộp thuế theo Mã số thuế (10 hoặc 13 chữ số), cập nhật địa chỉ hành chính mới nhất sau sáp nhập, người đại diện pháp luật, vốn điều lệ và tích hợp trình xem văn bản cảnh báo PDF gốc của Cơ quan Thuế (Mẫu 16/TB-ĐKT).
              </p>
            </div>

            <div className="p-5 rounded-2xl futuristic-card-inner space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="text-base sm:text-lg font-extrabold text-slate-900">
                  2. Kiểm tra Hóa đơn Điện tử (PDF / XML)
                </h4>
              </div>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Tự động giải mã tệp hóa đơn PDF hoặc XML chuẩn Thông tư 78/2021/TT-BTC, bóc tách chính xác MST và địa chỉ Đơn vị bán hàng để đối chiếu trạng thái pháp lý, đưa ra ký hiệu cảnh báo An toàn hoặc Nguy hiểm ngay trên từng chứng từ.
              </p>
            </div>

            <div className="p-5 rounded-2xl futuristic-card-inner space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="text-base sm:text-lg font-extrabold text-slate-900">
                  3. Quét Hàng loạt Nhà cung cấp
                </h4>
              </div>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Hỗ trợ kế toán rà soát danh sách lớn nhà cung cấp trước kỳ kê khai thuế thông qua file mẫu 3 cột độc lập (Số thứ tự, Mã số thuế, Tên doanh nghiệp) và xuất báo cáo kết quả đối soát rõ ràng, nhanh chóng.
              </p>
            </div>

            <div className="p-5 rounded-2xl futuristic-card-inner space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                  <BellRing className="w-5 h-5 text-blue-600" />
                </div>
                <h4 className="text-base sm:text-lg font-extrabold text-slate-900">
                  4. Theo dõi & Cảnh báo Tự động qua Email
                </h4>
              </div>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Lưu trữ danh mục nhà cung cấp thường xuyên giao dịch và cài đặt lịch quét tự động (hàng ngày hoặc hàng tuần theo khung giờ tùy chọn) để gửi cảnh báo ngay về email đăng nhập khi phát hiện người nộp thuế chuyển sang mức rủi ro cao.
              </p>
            </div>
          </div>
        </div>

        {/* Community Privacy & Security Commitment */}
        <div className="p-5 rounded-2xl bg-emerald-50/90 border border-emerald-200 flex items-start gap-3.5 text-sm sm:text-base text-emerald-950 leading-relaxed">
          <Lock className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-extrabold text-emerald-900">
              Cam kết Bảo mật vì Cộng đồng:
            </strong>{' '}
            Hệ thống xác thực hoàn toàn thông qua giao thức bảo mật tiêu chuẩn của Google, tuyệt đối không thu thập hay lưu trữ mật khẩu người dùng. Hạ tầng máy chủ được tối ưu hóa tải cao nhằm phục vụ ổn định hàng nghìn kế toán và doanh nghiệp truy cập tra cứu cùng lúc.
          </div>
        </div>
      </section>

      {/* System Preferences & Operational Settings */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
              Tùy chỉnh Vận hành Phần mềm
            </h2>
            <p className="text-sm sm:text-base text-slate-600 mt-0.5">
              Cấu hình chế độ đối soát mặc định khi tra cứu mã số thuế và kiểm tra hóa đơn
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-1">
              <div className="text-base font-extrabold text-slate-900">
                Đối soát chéo ngầm 4 bước đa nguồn
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">
                Tự động kiểm tra chéo dữ liệu Tổng cục Thuế, ĐKKD Quốc gia, địa giới hành chính và danh sách cảnh báo rủi ro hóa đơn.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoCrossCheck4Steps}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, autoCrossCheck4Steps: e.target.checked }))
              }
              className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
            />
          </label>

          <label className="p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-1">
              <div className="text-base font-extrabold text-slate-900">
                Mở sẵn Trình xem PDF gốc A4
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">
                Tự động hiển thị bản vẽ văn bản PDF gốc của Cơ quan Thuế (Mẫu 16/TB-ĐKT) ngay khi phát hiện doanh nghiệp rủi ro.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.defaultNativePdfViewer}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, defaultNativePdfViewer: e.target.checked }))
              }
              className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
            />
          </label>

          <label className="p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-1">
              <div className="text-base font-extrabold text-slate-900">
                Chuẩn hóa địa chỉ hành chính sau sáp nhập
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">
                Hiển thị đầy đủ địa chỉ trụ sở đăng ký thuế mới nhất và cơ quan thuế quản lý trực tiếp tương ứng.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPostMergerAddress}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, autoPostMergerAddress: e.target.checked }))
              }
              className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
            />
          </label>

          <label className="p-5 rounded-2xl futuristic-card-inner flex items-start justify-between gap-4 cursor-pointer">
            <div className="space-y-1">
              <div className="text-base font-extrabold text-slate-900">
                Tối ưu hóa file CSV Tiếng Việt cho Excel
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">
                Xuất file mẫu và kết quả đối soát chuẩn mã hóa Unicode tách cột tự động khi mở trên Microsoft Excel.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.excelUtf16CsvExport}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, excelUtf16CsvExport: e.target.checked }))
              }
              className="w-5 h-5 mt-1 accent-blue-600 rounded cursor-pointer shrink-0"
            />
          </label>
        </div>

        {savedNotice && (
          <div
            data-testid="settings-saved-banner"
            className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-base font-bold text-emerald-800"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-base font-bold rounded-xl transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Khôi phục mặc định</span>
          </button>

          <button
            type="button"
            data-testid="save-software-settings-btn"
            onClick={handleSaveSettings}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer"
          >
            <ShieldCheck className="w-5 h-5" />
            <span>Lưu Cài đặt Phần mềm</span>
          </button>
        </div>
      </section>
    </div>
  );
};
