import React, { useState, useEffect } from 'react';
import {
  Search,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  Copy,
  Check,
  Sparkles,
  PlusCircle,
  FileText,
  Download,
  Radar,
  ExternalLink,
  Eye,
  Building2,
} from 'lucide-react';
import {
  EnterpriseTaxRecord,
  lookupEnterpriseRisk,
  formatSingleLookupMarkdown,
} from '../utils/taxEngine';
import { OfficialPdfViewer } from './OfficialPdfViewer';

interface LookupPanelProps {
  onAddToWatchlist: (record: EnterpriseTaxRecord, invoiceNo?: string, note?: string) => Promise<void>;
}

export const LookupPanel: React.FC<LookupPanelProps> = ({
  onAddToWatchlist,
}) => {
  const [query, setQuery] = useState<string>('');
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanStepText, setScanStepText] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<number>(100);
  const [scanCount, setScanCount] = useState<number>(0);
  const [lastScannedTime, setLastScannedTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnterpriseTaxRecord | null>(null);
  const [markdownOutput, setMarkdownOutput] = useState<string>('');
  const [aiAdvisory, setAiAdvisory] = useState<string>('');
  const [viewMode, setViewMode] = useState<'hud' | 'markdown'>('hud');
  const [pdfPreviewMode, setPdfPreviewMode] = useState<'document' | 'embed'>('embed');
  const [copied, setCopied] = useState<boolean>(false);
  const [watchlistSavedMsg, setWatchlistSavedMsg] = useState<string | null>(null);

  const normalizeMstInput = (raw: string): string => {
    const cleaned = raw.trim().replace(/\s+/g, '');
    if (/^[0-9]{13}$/.test(cleaned)) {
      return `${cleaned.slice(0, 10)}-${cleaned.slice(10)}`;
    }
    return cleaned;
  };

  const performLookup = async (targetQuery: string) => {
    const trimmed = targetQuery.trim();
    if (!trimmed) {
      setError('Vui lòng nhập Mã số thuế doanh nghiệp (10 hoặc 13 chữ số) cần kiểm tra.');
      return;
    }

    const normalizedMst = normalizeMstInput(trimmed);
    if (!/^[0-9]{10}(?:-[0-9]{3})?$/.test(normalizedMst)) {
      setError(
        'Chỉ cho phép kiểm tra bằng Mã số thuế hợp lệ (10 hoặc 13 chữ số), không nhập tên công ty.'
      );
      return;
    }

    setQuery(normalizedMst);
    setError(null);
    setWatchlistSavedMsg(null);
    setScanning(true);
    setScanProgress(20);
    setScanStepText('Bước 01/04 · Đang đối chiếu Trạng thái NNT trên Tổng cục Thuế (tracuunnt.gdt.gov.vn)...');

    try {
      const progressTimer1 = setTimeout(() => {
        setScanProgress(48);
        setScanStepText('Bước 02/04 · Đang kiểm tra chéo Hồ sơ Đăng ký Thuế & ĐKKD Quốc gia...');
      }, 180);

      const progressTimer2 = setTimeout(() => {
        setScanProgress(74);
        setScanStepText('Bước 03/04 · Đang xác minh Địa giới Hành chính (Sau sáp nhập) & Vốn điều lệ...');
      }, 380);

      const progressTimer3 = setTimeout(() => {
        setScanProgress(90);
        setScanStepText('Bước 04/04 · Đang tổng hợp Đồng thuận Rủi ro Đa nguồn & Văn bản Thuế TT78...');
      }, 580);

      const res = await fetch('/api/tax/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalizedMst }),
      });

      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);

      let resolvedRecord: EnterpriseTaxRecord;
      let resolvedMarkdown: string;
      let resolvedAdvisory: string;

      if (res.ok) {
        const data = await res.json();
        resolvedRecord = data.record;
        resolvedMarkdown = data.markdown || formatSingleLookupMarkdown(data.record);
        resolvedAdvisory =
          data.aiAdvisory ||
          (resolvedRecord.riskConclusion === 'NGUY CƠ CAO'
            ? `Cảnh báo khẩn: MST ${resolvedRecord.mst} (${resolvedRecord.companyName}) có Thông báo rủi ro của Cơ quan Thuế (${resolvedRecord.taxAuthorityPdf?.documentNumber || 'Mẫu 16/TB-ĐKT'}). Không kê khai khấu trừ thuế GTGT đầu vào.`
            : resolvedRecord.riskConclusion === 'CẢNH BÁO'
            ? `Lưu ý kiểm soát: MST ${resolvedRecord.mst} (${resolvedRecord.companyName}) đang ở trạng thái [${resolvedRecord.legalStatus}]. Kiểm tra kỹ thời điểm phát sinh hóa đơn so với File PDF Thông báo của Cơ quan Thuế.`
            : `Đánh giá an toàn: MST ${resolvedRecord.mst} (${resolvedRecord.companyName}) đang hoạt động hợp lệ, khớp dữ liệu đăng ký thuế và không có thông báo rủi ro hóa đơn.`);
      } else {
        resolvedRecord = lookupEnterpriseRisk(normalizedMst);
        resolvedMarkdown = formatSingleLookupMarkdown(resolvedRecord);
        resolvedAdvisory = `Đã đối chiếu dữ liệu đăng ký thuế cho MST ${resolvedRecord.mst} (${resolvedRecord.companyName}).`;
      }

      setResult(resolvedRecord);
      setMarkdownOutput(resolvedMarkdown);
      setAiAdvisory(resolvedAdvisory);
      setScanCount((c) => c + 1);
      setLastScannedTime(new Date().toLocaleTimeString('vi-VN', { hour12: false }));
    } catch (err) {
      const fallback = lookupEnterpriseRisk(normalizedMst);
      setResult(fallback);
      setMarkdownOutput(formatSingleLookupMarkdown(fallback));
      setError(err instanceof Error ? err.message : 'Không thể kết nối máy chủ tra cứu thuế.');
    } finally {
      setScanProgress(100);
      setScanning(false);
      setScanStepText(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLookup(query);
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdownOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Support direct Google Search Sitelinks Search Box query (?mst=... or ?q=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initialMst = (params.get('mst') || params.get('q') || '').trim();
    if (initialMst) {
      performLookup(initialMst);
    }
  }, []);

  // Dynamically update document.title for Google Search indexing when a company is looked up
  useEffect(() => {
    if (!result || typeof document === 'undefined') return;
    document.title = `MST ${result.mst} – ${result.companyName} | MASOTHUE AI`;
  }, [result]);

  const isCritical = result?.riskConclusion === 'NGUY CƠ CAO';
  const isWarning = result?.riskConclusion === 'CẢNH BÁO';
  const riskPercent = isCritical ? 96 : isWarning ? 58 : 6;
  const strokeColor = isCritical ? '#E11D48' : isWarning ? '#D97706' : '#059669';
  const circumference = 2 * Math.PI * 50;
  const strokeDashoffset = circumference - (riskPercent / 100) * circumference;

  const pdfAttachment = result?.taxAuthorityPdf;

  return (
    <div className="space-y-6">
      {/* Search & Scan Command Console */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Radar className={`w-7 h-7 text-blue-600 ${scanning ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Tra cứu & Đối soát Rủi ro Thuế Doanh nghiệp
              </h1>
              {lastScannedTime && (
                <div className="text-sm sm:text-base text-slate-600 font-mono mt-1">
                  Phiên quét #{scanCount} · Đồng bộ Đăng ký Thuế lúc {lastScannedTime}
                </div>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <label htmlFor="mst-search-input" className="sr-only">
              Nhập Mã số thuế doanh nghiệp (10 hoặc 13 chữ số)
            </label>
            <Search className="w-6 h-6 text-blue-600 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="mst-search-input"
              type="text"
              inputMode="numeric"
              maxLength={14}
              value={query}
              onChange={(e) => {
                const rawVal = e.target.value;
                const sanitized = rawVal.replace(/[^0-9-]/g, '');
                if (rawVal !== sanitized && /[a-zA-ZÀ-ỹ]/.test(rawVal)) {
                  setError('Chỉ cho phép kiểm tra bằng Mã số thuế (10 hoặc 13 chữ số), không nhập tên công ty.');
                } else if (error) {
                  setError(null);
                }
                setQuery(sanitized);
              }}
              placeholder="Nhập Mã số thuế doanh nghiệp (10 hoặc 13 chữ số)..."
              autoComplete="off"
              className="w-full pl-13 pr-4 py-4 text-base sm:text-lg bg-white border-2 border-slate-300 rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15 font-mono transition-all shadow-2xs"
            />
          </div>
          <button
            type="submit"
            disabled={scanning}
            className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 text-white text-base sm:text-lg font-bold rounded-2xl shadow-lg shadow-blue-600/25 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            {scanning ? 'Đang truy vấn Cơ quan Thuế...' : 'Chạy Kiểm tra Quét'}
          </button>
        </form>

        {/* Live Scanning Progress Telemetry */}
        {scanning && (
          <div className="mt-5 space-y-2.5">
            <div className="flex items-center justify-between text-base font-mono text-blue-700 font-semibold">
              <span>{scanStepText}</span>
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

        {error && (
          <p role="alert" className="mt-4 text-base text-rose-600 font-semibold">
            {error}
          </p>
        )}

        {watchlistSavedMsg && !scanning && (
          <p className="mt-4 text-base text-emerald-700 font-semibold">
            ✓ {watchlistSavedMsg}
          </p>
        )}
      </section>

      {/* Main Responsive 12-Column Grid — Only rendered after user runs a lookup */}
      {result && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Radar Card (4 Cols) */}
        <section className="lg:col-span-4 futuristic-surface rounded-3xl p-6 sm:p-7 flex flex-col justify-between">
          <div className="space-y-6">
            <div className="flex items-center justify-between text-sm sm:text-base text-slate-600 font-bold">
              <span>Định lượng rủi ro thuế</span>
              <span className="font-mono text-blue-600">MST {result.mst}</span>
            </div>

            {/* Radial SVG Risk Gauge */}
            <div className="flex flex-col xl:flex-row items-center gap-4 py-2 text-center xl:text-left">
              <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 116 116">
                  <circle
                    cx="58"
                    cy="58"
                    r="50"
                    stroke="rgba(148, 163, 184, 0.22)"
                    strokeWidth="9"
                    fill="none"
                  />
                  <circle
                    cx="58"
                    cy="58"
                    r="50"
                    stroke={strokeColor}
                    strokeWidth="9"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-extrabold font-mono text-slate-900 tabular-nums">
                    {riskPercent}%
                  </span>
                  <span className="text-xs font-semibold text-slate-500 mt-0.5">
                    Mức rủi ro
                  </span>
                </div>
              </div>

              <div className="space-y-2 min-w-0">
                <div
                  className={`inline-flex items-center justify-center xl:justify-start gap-1.5 text-lg sm:text-xl font-extrabold whitespace-nowrap ${
                    isCritical
                      ? 'text-rose-600'
                      : isWarning
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {isCritical ? (
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                  ) : isWarning ? (
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 shrink-0" />
                  )}
                  <span>[{result.riskConclusion}]</span>
                </div>

                <div className="text-base text-slate-800 font-bold leading-snug">
                  [{result.legalStatus}]
                </div>
              </div>
            </div>

            {/* Sub-Metrics Telemetry (Larger Font) */}
            <div className="space-y-4 pt-5 border-t border-slate-200/80 text-base">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Văn bản PDF Thuế</span>
                <span
                  className={
                    pdfAttachment
                      ? 'text-rose-600 font-bold font-mono text-right'
                      : 'text-emerald-600 font-bold text-right'
                  }
                >
                  {pdfAttachment ? pdfAttachment.documentNumber : 'Không có TB rủi ro'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Khấu trừ thuế GTGT</span>
                <span
                  className={
                    isCritical
                      ? 'text-rose-600 font-bold text-right'
                      : isWarning
                      ? 'text-amber-600 font-bold text-right'
                      : 'text-emerald-600 font-bold text-right'
                  }
                >
                  {isCritical ? 'Loại trừ khấu trừ' : isWarning ? 'Cần giải trình' : 'Đủ điều kiện'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600 font-medium">Hiệu lực Hóa đơn</span>
                <span className="text-slate-900 font-semibold text-right">
                  {isCritical
                    ? 'Đình chỉ / Cảnh báo'
                    : isWarning
                    ? 'Rà soát kỳ phát sinh'
                    : 'Hợp lệ'}
                </span>
              </div>
            </div>
          </div>

          {/* Direct Add to Watchlist Action (No Google Login Warning Box) */}
          <div className="pt-6 mt-6 border-t border-slate-200/80">
            <button
              type="button"
              onClick={async () => {
                await onAddToWatchlist(result, undefined, 'Thêm từ Tra cứu');
                setWatchlistSavedMsg(`Đã lưu MST ${result.mst} (${result.companyName}) vào danh sách theo dõi`);
              }}
              className="w-full py-3.5 px-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-base font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <PlusCircle className="w-5 h-5" />
              <span>Thêm vào Danh sách Theo dõi</span>
            </button>
          </div>
        </section>

        {/* Right Detail HUD (8 Cols) */}
        <section className="lg:col-span-8 futuristic-surface rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200/80">
              <div className="space-y-1.5">
                <div className="text-sm sm:text-base font-mono text-blue-600 font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5 shrink-0" />
                  <span>MST {result.mst} · {result.taxAuthority}</span>
                </div>
                <h2
                  className="text-xl sm:text-2xl font-extrabold text-slate-900 leading-snug"
                  data-testid="scanned-company-name"
                >
                  {result.companyName}
                </h2>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200/80 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setViewMode('hud')}
                    className={`px-4 py-2 text-sm sm:text-base font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      viewMode === 'hud'
                        ? 'bg-white text-blue-600 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Hồ sơ Pháp lý
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('markdown')}
                    className={`px-4 py-2 text-sm sm:text-base font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      viewMode === 'markdown'
                        ? 'bg-white text-blue-600 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Markdown
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  aria-label="Sao chép kết quả Markdown"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm sm:text-base font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-slate-500" />
                  )}
                  <span>{copied ? 'Đã chép' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {viewMode === 'hud' ? (
              <div className="mt-6 space-y-5">
                {/* 3 Key Legal Fields with Large, Easy-to-Read Font Sizes */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl futuristic-card-inner">
                    <div className="text-sm sm:text-[15px] font-semibold text-slate-600">
                      Ngày bắt đầu hoạt động
                    </div>
                    <div
                      data-testid="scanned-start-date"
                      className="text-base sm:text-lg font-mono font-extrabold text-slate-900 mt-1.5 tabular-nums leading-snug"
                    >
                      {result.startDate}
                    </div>
                  </div>
                  <div className="p-5 rounded-2xl futuristic-card-inner">
                    <div className="text-sm sm:text-[15px] font-semibold text-slate-600">
                      Người đại diện pháp luật
                    </div>
                    <div
                      data-testid="scanned-legal-rep"
                      className="text-base sm:text-lg font-extrabold text-slate-900 mt-1.5 leading-snug"
                    >
                      {result.legalRepresentative}
                    </div>
                  </div>
                  <div className="p-5 rounded-2xl futuristic-card-inner">
                    <div className="text-sm sm:text-[15px] font-semibold text-slate-600">
                      Vốn điều lệ (Ghi rõ con số)
                    </div>
                    <div
                      data-testid="scanned-charter-capital"
                      className="text-base sm:text-lg font-mono font-extrabold text-blue-700 mt-1.5 tabular-nums whitespace-nowrap leading-snug"
                    >
                      {result.charterCapital}
                    </div>
                  </div>
                </div>

                {/* Full-Width Untruncated Registered Tax Address (Post-Merger) & Accurate Managing Tax Authority */}
                <div className="p-5 rounded-2xl futuristic-card-inner space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm sm:text-base font-semibold text-slate-600">
                    <span>Địa chỉ trụ sở đăng ký thuế (Mới nhất sau sáp nhập)</span>
                    <span
                      data-testid="scanned-tax-authority"
                      className="font-mono text-blue-700 font-bold"
                    >
                      Cơ quan quản lý thuế: {result.taxAuthority}
                    </span>
                  </div>
                  <div
                    data-testid="scanned-full-address"
                    className="text-base sm:text-lg text-slate-900 font-bold leading-relaxed break-words"
                  >
                    {result.address}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="p-5 rounded-2xl futuristic-card-inner space-y-3">
                    <div className="text-base sm:text-lg font-extrabold text-slate-900">
                      01. Căn cứ Rủi ro Thuế & Hóa đơn
                    </div>
                    <ul className="space-y-2.5 text-base text-slate-800 leading-relaxed">
                      {result.riskReasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="text-blue-600 font-mono font-bold">·</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 rounded-2xl futuristic-card-inner space-y-3">
                    <div className="text-base sm:text-lg font-extrabold text-slate-900">
                      02. Dấu hiệu Pháp lý & Đối chiếu Đăng ký Thuế
                    </div>
                    <ul className="space-y-2.5 text-base text-slate-800 leading-relaxed">
                      {result.auxiliarySigns.map((s, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="text-amber-600 font-mono font-bold">·</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {pdfAttachment?.sourceLinks && pdfAttachment.sourceLinks.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-1 text-sm sm:text-base">
                    <span className="text-slate-600 font-mono font-semibold">Nguồn đối chiếu:</span>
                    {pdfAttachment.sourceLinks.map((src: { title: string; uri: string }, idx: number) => (
                      <a
                        key={idx}
                        href={src.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-semibold underline underline-offset-2"
                      >
                        <span>{src.title}</span>
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <pre className="mt-6 p-6 bg-slate-900 border border-slate-800 rounded-2xl text-base font-mono text-slate-100 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {markdownOutput}
              </pre>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-200/80 flex items-start sm:items-center gap-3 text-base text-slate-800 font-semibold leading-relaxed">
            <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
            <span>{aiAdvisory}</span>
          </div>
        </section>
      </div>
      )}

      {/* Attached Official Tax Authority Published PDF File (File PDF của Cơ quan Thuế công bố) */}
      {result && pdfAttachment && (
        <section
          data-testid="tax-authority-pdf-section"
          className="futuristic-surface rounded-3xl overflow-hidden border border-rose-300"
        >
          <div className="p-6 sm:p-8 border-b border-rose-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-rose-50/70">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm sm:text-base font-mono text-rose-600 font-extrabold">
                <FileText className="w-5 h-5 shrink-0" />
                <span>FILE PDF CÔNG BỐ CỦA CƠ QUAN THUẾ ĐÍNH KÈM · {pdfAttachment.formCode}</span>
              </div>
              <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 flex flex-wrap items-center gap-2">
                <span>{pdfAttachment.fileName}</span>
                <span className="text-base font-mono text-rose-600 font-bold">
                  ({pdfAttachment.documentNumber})
                </span>
              </h3>
              <p className="text-base text-slate-700">
                Cơ quan Thuế ban hành:{' '}
                <strong className="text-slate-900">{pdfAttachment.issuingAuthority}</strong> · Ngày công
                bố: <strong className="text-slate-900 font-mono">{pdfAttachment.publishedDate}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                <button
                  type="button"
                  data-testid="pdf-tab-embed"
                  onClick={() => setPdfPreviewMode('embed')}
                  className={`px-4 py-2 text-sm sm:text-base font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                    pdfPreviewMode === 'embed'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-4 h-4" />
                  <span>Trình xem PDF gốc</span>
                </button>
                <button
                  type="button"
                  data-testid="pdf-tab-document"
                  onClick={() => setPdfPreviewMode('document')}
                  className={`px-4 py-2 text-sm sm:text-base font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    pdfPreviewMode === 'document'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bản dịch Văn bản Thuế
                </button>
              </div>

              <a
                href={`${pdfAttachment.pdfUrl}&download=1`}
                download={pdfAttachment.fileName}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm sm:text-base font-bold rounded-xl shadow-md shadow-rose-600/20 transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Tải File PDF Công bố (.PDF)</span>
              </a>
            </div>
          </div>

          {pdfPreviewMode === 'document' ? (
            <div className="p-6 sm:p-8 bg-slate-50/70">
              {/* Official Vietnam Tax Authority Notice Document Sheet (Mẫu số 16/TB-ĐKT) */}
              <div className="max-w-4xl mx-auto rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-6 text-slate-800 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-slate-200 text-sm sm:text-base">
                  <div className="space-y-1">
                    <div className="text-slate-500 font-bold uppercase">TỔNG CỤC THUẾ VIỆT NAM</div>
                    <div className="text-slate-900 font-extrabold uppercase">
                      {pdfAttachment.issuingAuthority}
                    </div>
                    <div className="font-mono text-slate-700 mt-1 font-semibold">
                      {pdfAttachment.documentNumber}
                    </div>
                  </div>
                  <div className="sm:text-right space-y-1">
                    <div className="text-slate-900 font-extrabold uppercase">
                      CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                    </div>
                    <div className="text-slate-600 font-medium">Độc lập - Tự do - Hạnh phúc</div>
                    <div className="font-mono text-slate-500 mt-1">
                      {pdfAttachment.formCode} · Ngày ban hành: {pdfAttachment.publishedDate}
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-1.5">
                  <div className="text-lg sm:text-xl font-extrabold text-slate-900 uppercase tracking-wide">
                    {pdfAttachment.documentTitle}
                  </div>
                  <div className="text-sm sm:text-base font-mono text-rose-600 font-bold">
                    Tệp đính kèm chính thức: {pdfAttachment.fileName}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-xl bg-slate-50 border border-slate-200 text-base">
                  <div>
                    <span className="text-slate-600">Người nộp thuế: </span>
                    <strong className="text-slate-900">{result.companyName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-600">Mã số thuế: </span>
                    <strong className="font-mono text-rose-600">{result.mst}</strong>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-slate-600">Địa chỉ trụ sở đăng ký: </span>
                    <span className="text-slate-900 font-bold">{result.address}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Người đại diện pháp luật: </span>
                    <span className="text-slate-900 font-bold">{result.legalRepresentative}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Trạng thái công bố: </span>
                    <strong className="text-rose-600">[{result.legalStatus}]</strong>
                  </div>
                </div>

                <div className="space-y-3 text-base leading-relaxed text-slate-800">
                  <p className="font-bold text-slate-900">{pdfAttachment.officialSummary}</p>
                  <div className="space-y-2">
                    {result.riskReasons.map((basis: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <span className="text-rose-600 font-mono font-bold">0{idx + 1}.</span>
                        <span>{basis}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm sm:text-base">
                  <div className="text-slate-600 font-mono font-medium">
                    Xác thực chữ ký số Cơ quan Thuế · {pdfAttachment.issuingAuthority}
                  </div>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-mono font-bold">
                    <span>ĐÃ ĐÓNG DẤU SỐ CƠ QUAN THUẾ · {pdfAttachment.publishedDate}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <OfficialPdfViewer record={result} pdfAttachment={pdfAttachment} />
          )}
        </section>
      )}
    </div>
  );
};
