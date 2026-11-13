import React, { useState } from 'react';
import {
  Upload,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Download,
  FileDown,
  Lock,
} from 'lucide-react';
import {
  BatchSupplierRowResult,
  parseBatchSupplierCsv,
  EnterpriseTaxRecord,
} from '../utils/taxEngine';

interface BatchUploadPanelProps {
  isAuthenticated: boolean;
  onGoogleSignIn: () => void;
  onBatchSyncWatchlist: (
    items: { record: EnterpriseTaxRecord; invoiceNo?: string; note?: string }[]
  ) => Promise<void>;
}

/**
 * Encode tabular rows as UTF-16LE with BOM + Tab delimiter (\t) so Microsoft Excel
 * on ALL regional locales (both ',' and ';') opens the .csv directly into separate columns
 * without ever merging them into 1 column.
 */
function createExcelMultiColumnCsvBlob(rows: string[][]): Blob {
  const tsvContent = rows
    .map((cols) =>
      cols
        .map((cell) => {
          const cleaned = String(cell ?? '').replace(/[\r\n\t]+/g, ' ').trim();
          return cleaned.includes('"') ? `"${cleaned.replace(/"/g, '""')}"` : cleaned;
        })
        .join('\t')
    )
    .join('\r\n');

  const withBom = '\uFEFF' + tsvContent;
  const buffer = new ArrayBuffer(withBom.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < withBom.length; i++) {
    view.setUint16(i * 2, withBom.charCodeAt(i), true);
  }
  return new Blob([buffer], { type: 'text/csv;charset=utf-16le;' });
}

/**
 * Decode an uploaded CSV/TSV file buffer supporting UTF-8, UTF-8 BOM, and UTF-16LE/BE BOM (Excel Unicode CSV)
 */
async function decodeUploadedCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  return new TextDecoder('utf-8').decode(buffer);
}

export const BatchUploadPanel: React.FC<BatchUploadPanelProps> = ({
  isAuthenticated,
  onGoogleSignIn,
  onBatchSyncWatchlist,
}) => {
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BatchSupplierRowResult[]>([]);
  const [filterRisk, setFilterRisk] = useState<'ALL' | 'NGUY CƠ CAO' | 'CẢNH BÁO' | 'AN TOÀN'>('ALL');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncDoneMessage, setSyncDoneMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleDownloadSupplierTemplate = () => {
    const templateRows: string[][] = [
      ['Số thứ tự', 'Mã số thuế', 'Tên doanh nghiệp'],
      ['1', '', ''],
      ['2', '', ''],
      ['3', '', ''],
    ];
    const blob = createExcelMultiColumnCsvBlob(templateRows);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Mau_DanhSach_NhaCungCap_MASOTHUE_AI.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <section
        data-testid="module-3-auth-gate"
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
            Quét Hàng loạt Nhà cung cấp (CSV / Excel)
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto">
            Chức năng tải file mẫu và upload danh sách nhà cung cấp hàng loạt yêu cầu bạn{' '}
            <strong>đăng nhập qua tài khoản Google</strong> để thực hiện đối soát.
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <button
            type="button"
            data-testid="module-3-google-login-btn"
            onClick={onGoogleSignIn}
            className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
          >
            Đăng nhập bằng tài khoản Google
          </button>
        </div>
      </section>
    );
  }

  const handleRunBatch = async (inputCsv: string, sourceFileName?: string) => {
    setSyncing(true);
    setSyncDoneMessage(null);
    setUploadError(null);
    try {
      const parsed = parseBatchSupplierCsv(inputCsv);
      if (parsed.length === 0) {
        setRows([]);
        setUploadError(
          'File tải lên chưa có dữ liệu Mã số thuế hoặc Tên doanh nghiệp. Vui lòng điền vào 3 cột (Số thứ tự, Mã số thuế, Tên doanh nghiệp) rồi tải lên lại.'
        );
        return;
      }

      let enrichedRows = parsed;

      try {
        const res = await fetch('/api/tax/batch-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries: parsed.map((r) => r.mst) }),
        });
        if (res.ok) {
          const data = (await res.json()) as { records?: Record<string, EnterpriseTaxRecord> };
          if (data.records) {
            enrichedRows = parsed.map((r) => {
              const serverRecord = data.records?.[r.mst];
              if (!serverRecord) return r;
              return {
                ...r,
                officialName: serverRecord.companyName,
                legalStatus: serverRecord.legalStatus,
                riskConclusion: serverRecord.riskConclusion,
                enterpriseRecord: serverRecord,
              };
            });
          }
        }
      } catch {
        // Keep parsed fallback if offline
      }

      setRows(enrichedRows);

      try {
        await onBatchSyncWatchlist(
          enrichedRows.map((r) => ({
            record: r.enterpriseRecord,
            invoiceNo: r.invoiceNo || undefined,
            note: r.note,
          }))
        );
      } catch {
        // Preserve batch results on screen even if watchlist sync has a transient error
      }

      setSyncDoneMessage(
        sourceFileName
          ? `Đã tải lên file "${sourceFileName}" (tách chuẩn 3 cột: Số thứ tự, Mã số thuế, Tên doanh nghiệp) và đối soát thành công ${enrichedRows.length} doanh nghiệp.`
          : `Đã đối soát đa nguồn thành công ${enrichedRows.length} doanh nghiệp.`
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const text = await decodeUploadedCsvFile(file);
    await handleRunBatch(text, file.name);
    e.target.value = '';
  };

  const handleExportReportCsv = () => {
    const exportRows: string[][] = [
      [
        'Số thứ tự',
        'Mã số thuế',
        'Tên doanh nghiệp',
        'Địa chỉ mới nhất',
        'Cơ quan quản lý thuế',
        'Trạng thái Pháp lý',
        'Kết luận Rủi ro',
      ],
      ...rows.map((r, idx) => [
        String(r.stt || idx + 1),
        r.mst,
        r.officialName || r.inputName,
        r.enterpriseRecord.address,
        r.enterpriseRecord.taxAuthority,
        r.legalStatus,
        r.riskConclusion,
      ]),
    ];
    const blob = createExcelMultiColumnCsvBlob(exportRows);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `KetQua_DoiSoat_NCC.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows =
    filterRisk === 'ALL' ? rows : rows.filter((r) => r.riskConclusion === filterRisk);

  const countHigh = rows.filter((r) => r.riskConclusion === 'NGUY CƠ CAO').length;
  const countWarn = rows.filter((r) => r.riskConclusion === 'CẢNH BÁO').length;
  const countSafe = rows.filter((r) => r.riskConclusion === 'AN TOÀN').length;

  return (
    <div className="space-y-6">
      {/* Top Section: Row 1 (Heading) separated from Row 2 (Action Toolbar) & Row 3 (KPI Cards) */}
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8 space-y-6">
        {/* Dòng 1: Tiêu đề Quét Hàng loạt Nhà cung cấp (Tách riêng 1 dòng độc lập) */}
        <div className="pb-5 border-b border-slate-200/80">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Quét Hàng loạt Nhà cung cấp (CSV / Excel)
          </h1>
          <p className="text-sm sm:text-base text-slate-600 mt-1.5">
            {uploadedFileName
              ? `File đang kiểm tra: ${uploadedFileName} (3 cột: Số thứ tự · Mã số thuế · Tên doanh nghiệp)`
              : 'Tải file mẫu (.CSV) gồm 3 cột (Số thứ tự, Mã số thuế, Tên doanh nghiệp), điền thông tin và bấm Upload File sau khi điền.'}
          </p>
        </div>

        {/* Dòng 2: Thanh tác vụ Tải file mẫu, Upload file và Xuất kết quả nổi bật (Tách riêng dòng) */}
        <div
          data-testid="batch-action-toolbar-row"
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="download-supplier-template-btn"
              onClick={handleDownloadSupplierTemplate}
              className="inline-flex items-center gap-2.5 px-5 py-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-base font-bold rounded-xl cursor-pointer transition-colors"
            >
              <FileDown className="w-5 h-5 text-blue-600 shrink-0" />
              <span>Tải File Mẫu (.CSV)</span>
            </button>

            <label
              htmlFor="batch-csv-upload"
              data-testid="upload-filled-supplier-btn"
              className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-md shadow-blue-600/20 cursor-pointer transition-all"
            >
              <Upload className="w-5 h-5 shrink-0" />
              <span>{syncing ? 'Đang đọc & đối soát...' : 'Upload File sau khi điền'}</span>
              <input
                id="batch-csv-upload"
                type="file"
                accept=".csv,.txt,.tsv"
                onChange={handleCsvFileUpload}
                className="sr-only"
              />
            </label>
          </div>

          {/* Nút Xuất Kết quả được làm nổi bật */}
          <button
            type="button"
            data-testid="export-batch-result-btn"
            onClick={handleExportReportCsv}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-base sm:text-lg font-extrabold rounded-xl shadow-lg shadow-emerald-600/30 ring-2 ring-emerald-400/60 transition-all cursor-pointer"
          >
            <Download className="w-5 h-5 shrink-0" />
            <span>Xuất Kết quả Đối soát {rows.length > 0 ? `(${rows.length} DN)` : '(.CSV)'}</span>
          </button>
        </div>

        {/* 4 Compact KPI Bento Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 tabular-nums">
          <div className="p-5 rounded-2xl futuristic-card-inner">
            <div className="text-sm sm:text-base font-semibold text-slate-600">Tổng Nhà cung cấp</div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-slate-900 mt-1">{rows.length}</div>
          </div>
          <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200">
            <div className="text-sm sm:text-base font-semibold text-rose-700">Nguy cơ cao (Mẫu 16/TB-ĐKT)</div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-rose-600 mt-1">{countHigh}</div>
          </div>
          <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200">
            <div className="text-sm sm:text-base font-semibold text-amber-700">Cảnh báo (Tạm ngừng)</div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-amber-600 mt-1">{countWarn}</div>
          </div>
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200">
            <div className="text-sm sm:text-base font-semibold text-emerald-700">An toàn</div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-emerald-600 mt-1">{countSafe}</div>
          </div>
        </div>

        {syncDoneMessage && (
          <div className="flex items-center gap-2.5 text-base text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3.5">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
            <span>{syncDoneMessage}</span>
          </div>
        )}

        {uploadError && (
          <div
            role="alert"
            className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-base text-rose-800 font-semibold"
          >
            {uploadError}
          </div>
        )}
      </section>

      {/* Filter & 3-Column Data Results Table */}
      <section className="futuristic-surface rounded-3xl overflow-hidden">
        <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <span className="text-lg sm:text-xl font-extrabold text-slate-900">
            Kết quả đối soát hàng loạt nhà cung cấp
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl">
            {(['ALL', 'NGUY CƠ CAO', 'CẢNH BÁO', 'AN TOÀN'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterRisk(tab)}
                className={`px-4 py-2 text-sm sm:text-base font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  filterRisk === tab
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'ALL' ? 'Tất cả' : tab}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table
            data-testid="batch-results-table"
            className="w-full text-left border-collapse text-base sm:text-[17px]"
          >
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-sm sm:text-base font-bold text-slate-700">
                <th className="py-4 px-5 w-28 border-r border-slate-200/60">Số thứ tự</th>
                <th className="py-4 px-5 w-44 border-r border-slate-200/60">Mã số thuế</th>
                <th className="py-4 px-6 border-r border-slate-200/60">Tên doanh nghiệp</th>
                <th className="py-4 px-6 border-r border-slate-200/60">Địa chỉ & Cơ quan thuế</th>
                <th className="py-4 px-5 border-r border-slate-200/60">Trạng thái pháp lý</th>
                <th className="py-4 px-5">Kết luận rủi ro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-6 text-center text-slate-500 text-base">
                    Chưa có dữ liệu nhà cung cấp. Vui lòng bấm <strong>Tải File Mẫu (.CSV)</strong>, điền 3 cột (<strong>Số thứ tự</strong>, <strong>Mã số thuế</strong>, <strong>Tên doanh nghiệp</strong>) và bấm <strong>Upload File sau khi điền</strong>.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={`${row.mst}-${idx}`} className="hover:bg-slate-50/80">
                    {/* Cột 1: Số thứ tự */}
                    <td className="py-4.5 px-5 font-mono font-bold text-slate-700 tabular-nums border-r border-slate-200/60">
                      {row.stt || idx + 1}
                    </td>
                    {/* Cột 2: Mã số thuế */}
                    <td className="py-4.5 px-5 font-mono font-extrabold text-slate-900 tabular-nums border-r border-slate-200/60">
                      {row.mst}
                    </td>
                    {/* Cột 3: Tên doanh nghiệp */}
                    <td className="py-4.5 px-6 font-bold text-slate-900 border-r border-slate-200/60">
                      {row.officialName || row.inputName}
                    </td>
                    {/* Cột 4: Địa chỉ & Cơ quan thuế */}
                    <td className="py-4.5 px-6 text-sm sm:text-base text-slate-700 border-r border-slate-200/60">
                      <div>{row.enterpriseRecord.address}</div>
                      <div className="font-mono text-blue-600 font-semibold mt-0.5">
                        {row.enterpriseRecord.taxAuthority}
                      </div>
                    </td>
                    {/* Cột 5: Trạng thái pháp lý */}
                    <td className="py-4.5 px-5 text-slate-800 font-semibold border-r border-slate-200/60">
                      [{row.legalStatus}]
                    </td>
                    {/* Cột 6: Kết luận rủi ro */}
                    <td className="py-4.5 px-5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-2 font-extrabold ${
                          row.riskConclusion === 'NGUY CƠ CAO'
                            ? 'text-rose-600'
                            : row.riskConclusion === 'CẢNH BÁO'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {row.riskConclusion === 'NGUY CƠ CAO' ? (
                          <ShieldAlert className="w-5 h-5" />
                        ) : row.riskConclusion === 'CẢNH BÁO' ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : (
                          <ShieldCheck className="w-5 h-5" />
                        )}
                        <span>[{row.riskConclusion}]</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
