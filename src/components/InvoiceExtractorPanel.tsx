import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  FileText,
  Download,
  Eye,
  Radar,
  Lock,
  UploadCloud,
} from 'lucide-react';
import {
  InvoiceExtractionResult,
  parseAndEvaluateInvoice,
  EnterpriseTaxRecord,
} from '../utils/taxEngine';
import { OfficialPdfViewer } from './OfficialPdfViewer';

interface InvoiceExtractorPanelProps {
  isAuthenticated: boolean;
  onGoogleSignIn: () => void;
  onInvoiceExtracted: (
    invoice: InvoiceExtractionResult,
    enterprise: EnterpriseTaxRecord
  ) => Promise<void>;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const InvoiceExtractorPanel: React.FC<InvoiceExtractorPanelProps> = ({
  isAuthenticated,
  onGoogleSignIn,
  onInvoiceExtracted,
}) => {
  const [rawXmlContent, setRawXmlContent] = useState<string>('');
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [lastUploadedBinary, setLastUploadedBinary] = useState<{
    fileName: string;
    base64Data: string;
    mimeType: string;
  } | null>(null);
  const [extractionResult, setExtractionResult] = useState<InvoiceExtractionResult | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showSellerPdfViewer, setShowSellerPdfViewer] = useState<boolean>(true);

  if (!isAuthenticated) {
    return (
      <section
        data-testid="module-2-auth-gate"
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
            Kiểm tra Hóa đơn Điện tử (PDF / XML)
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto">
            Chức năng tải lên (Upload) và bóc tách nội dung hóa đơn điện tử yêu cầu bạn{' '}
            <strong>đăng nhập qua tài khoản Google</strong> để thực hiện và lưu lịch sử đối soát.
          </p>
        </div>

        <div className="pt-2 flex justify-center">
          <button
            type="button"
            data-testid="module-2-google-login-btn"
            onClick={onGoogleSignIn}
            className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
          >
            Đăng nhập bằng tài khoản Google
          </button>
        </div>
      </section>
    );
  }

  const runServerAssistedInvoiceExtraction = async (params: {
    fileName: string;
    rawText: string;
    base64Data?: string;
    mimeType?: string;
  }) => {
    setProcessing(true);
    setSyncMessage(null);
    setUploadError(null);
    try {
      const res = await fetch('/api/tax/extract-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: params.fileName,
          rawText: params.rawText,
          rawContent: params.rawText,
          base64Data: params.base64Data,
          mimeType: params.mimeType,
        }),
      });

      let evaluated: InvoiceExtractionResult;
      if (res.ok) {
        const data = await res.json();
        evaluated = data.result;
        if (data.extractedText && !params.rawText.includes('<HDon')) {
          setRawXmlContent(data.extractedText);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể giải mã hóa đơn trên máy chủ.');
      }

      setExtractionResult(evaluated);
      setSyncMessage(
        `Đã đọc và quét thành công file "${params.fileName}": MST người bán ${evaluated.sellerMst} (${evaluated.enterpriseRecord.companyName}) · Ký hiệu ${evaluated.invoiceSymbol} · Số HĐ ${evaluated.invoiceNumber}`
      );

      try {
        await onInvoiceExtracted(evaluated, evaluated.enterpriseRecord);
      } catch {
        // Keep extracted invoice result visible even if background watchlist persistence has a transient error
      }
    } catch (err) {
      if (params.rawText && params.rawText.trim().length > 0) {
        const fallback = parseAndEvaluateInvoice(params.fileName, params.rawText);
        setExtractionResult(fallback);
      }
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc tệp hóa đơn. Vui lòng kiểm tra lại định dạng PDF / XML.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleRunInvoiceScan = async () => {
    if (!currentFileName && !rawXmlContent.trim() && !lastUploadedBinary) {
      setUploadError('Vui lòng chọn tải lên File Hóa đơn (.PDF / .XML) trước khi quét.');
      return;
    }

    const useBinary =
      lastUploadedBinary &&
      (!rawXmlContent.trim() || lastUploadedBinary.fileName === currentFileName);

    await runServerAssistedInvoiceExtraction({
      fileName: currentFileName || lastUploadedBinary?.fileName || 'HoaDon_TT78.pdf',
      rawText: rawXmlContent,
      base64Data: useBinary ? lastUploadedBinary.base64Data : undefined,
      mimeType: useBinary ? lastUploadedBinary.mimeType : undefined,
    });
  };

  const processUploadedFile = async (file: File) => {
    setCurrentFileName(file.name);
    setUploadError(null);

    const buffer = await file.arrayBuffer();
    const base64Data = arrayBufferToBase64(buffer);
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type.includes('pdf') || lowerName.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lowerName);

    let textContent = '';
    if (!isPdf && !isImage) {
      textContent = new TextDecoder('utf-8').decode(buffer);
      setRawXmlContent(textContent);
      setLastUploadedBinary(null);
    } else {
      setRawXmlContent('');
    }

    const resolvedMime =
      file.type ||
      (isPdf
        ? 'application/pdf'
        : lowerName.endsWith('.xml')
        ? 'text/xml'
        : 'application/octet-stream');

    if (isPdf || isImage) {
      setLastUploadedBinary({
        fileName: file.name,
        base64Data,
        mimeType: resolvedMime,
      });
    }

    await runServerAssistedInvoiceExtraction({
      fileName: file.name,
      rawText: textContent,
      base64Data,
      mimeType: resolvedMime,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
  };

  const pdfAttachment = extractionResult?.enterpriseRecord.taxAuthorityPdf;

  const isDangerousLegalStatus = extractionResult
    ? extractionResult.enterpriseRecord.riskConclusion === 'NGUY CƠ CAO' ||
      extractionResult.enterpriseRecord.legalStatus === 'Không hoạt động tại địa chỉ đăng ký' ||
      extractionResult.enterpriseRecord.legalStatus === 'Ngừng hoạt động chờ làm thủ tục đóng MST' ||
      extractionResult.enterpriseRecord.legalStatus === 'Giải thể / Đóng MST'
    : false;

  const isWarningLegalStatus = extractionResult
    ? !isDangerousLegalStatus &&
      (extractionResult.enterpriseRecord.riskConclusion === 'CẢNH BÁO' ||
        extractionResult.enterpriseRecord.legalStatus === 'Tạm ngừng kinh doanh' ||
        extractionResult.recommendation === 'Cần giải trình')
    : false;

  return (
    <div className="space-y-6">
      <section className="futuristic-surface rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Radar className={`w-7 h-7 text-blue-600 ${processing ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Kiểm tra Hóa đơn Điện tử (PDF / XML)
              </h1>
              {currentFileName ? (
                <p className="text-sm sm:text-base text-slate-600 mt-1 font-mono">
                  Tệp đang kiểm tra: <strong className="text-blue-700">{currentFileName}</strong>
                </p>
              ) : (
                <p className="text-sm sm:text-base text-slate-600 mt-1">
                  Tải lên tệp hóa đơn PDF hoặc XML để bóc tách chỉ tiêu và đối soát rủi ro người bán
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              data-testid="run-invoice-scan-btn"
              onClick={handleRunInvoiceScan}
              disabled={processing}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer whitespace-nowrap"
            >
              {processing ? 'Đang đọc & quét Hóa đơn...' : 'Chạy Quét Hóa đơn'}
            </button>
          </div>
        </div>

        {/* Single Streamlined Upload Dropzone */}
        <label
          htmlFor="invoice-file-dropzone"
          data-testid="invoice-upload-label"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`w-full p-6 rounded-2xl border-2 border-dashed transition-colors flex items-center justify-between gap-4 cursor-pointer ${
            isDragging
              ? 'border-blue-600 bg-blue-100/60'
              : 'border-blue-300 bg-blue-50/40 hover:bg-blue-50/80'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white border border-blue-200 flex items-center justify-center shrink-0">
              <UploadCloud className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900">
                Bấm để chọn hoặc kéo thả File Hóa đơn vào đây (.PDF, .XML, .HTML, Ảnh)
              </div>
              <div className="text-sm sm:text-[15px] text-slate-600 mt-0.5">
                Hệ thống tự động giải mã văn bản hóa đơn PDF/XML, trích xuất MST người bán và đối chiếu rủi ro với Cơ quan Thuế.
              </div>
            </div>
          </div>
          <span className="hidden sm:inline-flex px-5 py-2.5 bg-blue-600 text-white text-sm sm:text-base font-bold rounded-xl shrink-0">
            Chọn File Hóa đơn
          </span>
          <input
            id="invoice-file-dropzone"
            data-testid="invoice-file-input"
            type="file"
            accept=".xml,.pdf,.html,.txt,.png,.jpg,.jpeg"
            onChange={handleFileUpload}
            className="sr-only"
          />
        </label>

        {syncMessage && (
          <div
            data-testid="invoice-scan-success-banner"
            className="flex items-center gap-2.5 text-base text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3.5"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
            <span>{syncMessage}</span>
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

      {/* Output Table — Only rendered after user uploads/scans an invoice */}
      {extractionResult && (
        <section className="futuristic-surface rounded-3xl overflow-hidden">
          <div className="px-6 sm:px-8 py-5 border-b border-slate-200/80 flex items-center justify-between gap-4">
            <div className="text-lg sm:text-xl font-extrabold text-slate-900">
              Bảng Đối soát Chỉ tiêu Hóa đơn & Rủi ro Người bán
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-base sm:text-[17px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-sm sm:text-base font-bold text-slate-600">
                  <th className="py-4 px-6 w-56">Tiêu chí</th>
                  <th className="py-4 px-6">Giá trị bóc tách từ Hóa đơn</th>
                  <th className="py-4 px-6 w-80">Đánh giá rủi ro người bán</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60">
                {/* Row 1: MST Người bán */}
                <tr className="hover:bg-slate-50/80">
                  <td className="py-4.5 px-6 font-semibold text-slate-600">MST Người bán</td>
                  <td
                    data-testid="extracted-seller-mst"
                    className="py-4.5 px-6 font-mono font-extrabold text-slate-900 tabular-nums"
                  >
                    {extractionResult.sellerMst}
                  </td>
                  <td className="py-4.5 px-6">
                    <span
                      className={`font-extrabold ${
                        extractionResult.sellerMstEvaluation === 'Nguy cơ cao'
                          ? 'text-rose-600'
                          : extractionResult.sellerMstEvaluation === 'Cảnh báo'
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                      }`}
                    >
                      [{extractionResult.sellerMstEvaluation}]
                    </span>
                  </td>
                </tr>

                {/* Row 2: Tên Người bán (Tách dòng riêng) */}
                <tr className="hover:bg-slate-50/80">
                  <td className="py-4.5 px-6 font-semibold text-slate-600">Tên Người bán</td>
                  <td
                    data-testid="extracted-seller-name"
                    className="py-4.5 px-6 font-bold text-slate-900"
                  >
                    {extractionResult.sellerName}
                  </td>
                  <td className="py-4.5 px-6">
                    <span
                      className={`font-extrabold ${
                        extractionResult.sellerNameEvaluation === 'Khớp MST'
                          ? 'text-emerald-600'
                          : 'text-amber-600'
                      }`}
                    >
                      [{extractionResult.sellerNameEvaluation}]
                    </span>
                  </td>
                </tr>

                {/* Row 3: Địa chỉ Người bán (Tách dòng riêng) */}
                <tr className="hover:bg-slate-50/80">
                  <td className="py-4.5 px-6 font-semibold text-slate-600">Địa chỉ Người bán</td>
                  <td
                    data-testid="extracted-seller-address"
                    className="py-4.5 px-6 text-slate-800 font-medium"
                  >
                    {extractionResult.enterpriseRecord.address}
                  </td>
                  <td className="py-4.5 px-6 text-sm sm:text-base font-semibold text-blue-700">
                    {extractionResult.enterpriseRecord.taxAuthority}
                  </td>
                </tr>

                {/* Row 4: Số HĐ & Ký hiệu */}
                <tr className="hover:bg-slate-50/80">
                  <td className="py-4.5 px-6 font-semibold text-slate-600">Số HĐ & Ký hiệu</td>
                  <td
                    data-testid="extracted-invoice-code"
                    className="py-4.5 px-6 font-mono font-bold text-blue-600 tabular-nums"
                  >
                    {extractionResult.invoiceSymbol} · Số {extractionResult.invoiceNumber}
                  </td>
                  <td className="py-4.5 px-6 text-slate-800 font-medium">
                    {extractionResult.tt78Valid
                      ? 'Hợp lệ theo chuẩn Hóa đơn điện tử'
                      : 'Cần kiểm tra ký hiệu hóa đơn'}
                  </td>
                </tr>

                {/* Row 5: Ngày lập HĐ */}
                <tr className="hover:bg-slate-50/80">
                  <td className="py-4.5 px-6 font-semibold text-slate-600">Ngày lập HĐ</td>
                  <td className="py-4.5 px-6 font-mono text-slate-900 font-bold tabular-nums">
                    {extractionResult.issueDate}
                  </td>
                  <td className="py-4.5 px-6 text-slate-800 font-medium">
                    {extractionResult.issueDateEvaluation}
                  </td>
                </tr>

                {/* Row 6 (Final Row): Trạng thái pháp lý & Ký hiệu cảnh báo An toàn / Nguy hiểm */}
                <tr
                  data-testid="invoice-final-status-row"
                  className={
                    isDangerousLegalStatus
                      ? 'bg-rose-50/80'
                      : isWarningLegalStatus
                      ? 'bg-amber-50/80'
                      : 'bg-emerald-50/70'
                  }
                >
                  <td className="py-5 px-6 font-extrabold text-slate-900">
                    Trạng thái pháp lý & Khuyến nghị
                  </td>
                  <td className="py-5 px-6 space-y-1">
                    <div className="font-bold text-slate-900">
                      Trạng thái pháp lý:{' '}
                      <span
                        className={
                          isDangerousLegalStatus
                            ? 'text-rose-700 font-extrabold'
                            : isWarningLegalStatus
                            ? 'text-amber-700 font-extrabold'
                            : 'text-emerald-700 font-extrabold'
                        }
                      >
                        [{extractionResult.enterpriseRecord.legalStatus}]
                      </span>
                    </div>
                    <div className="text-sm sm:text-base text-slate-700 font-medium">
                      Khuyến nghị kê khai: <strong>[{extractionResult.recommendation}]</strong>
                    </div>
                  </td>
                  <td className="py-5 px-6" data-testid="legal-status-warning-indicator">
                    {isDangerousLegalStatus ? (
                      <div className="inline-flex items-center gap-2.5 text-rose-700 font-extrabold text-base sm:text-lg">
                        <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0" />
                        <span>NGUY HIỂM · RỦI RO CAO</span>
                      </div>
                    ) : isWarningLegalStatus ? (
                      <div className="inline-flex items-center gap-2.5 text-amber-700 font-extrabold text-base sm:text-lg">
                        <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                        <span>CẢNH BÁO · CẦN RÀ SOÁT</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2.5 text-emerald-700 font-extrabold text-base sm:text-lg">
                        <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                        <span>AN TOÀN · ĐỦ ĐIỀU KIỆN</span>
                      </div>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Attached Official Tax Authority PDF File for Seller if applicable */}
      {extractionResult && pdfAttachment && (
        <section className="futuristic-surface rounded-3xl overflow-hidden border border-rose-300">
          <div className="p-6 sm:p-8 border-b border-rose-200/80 bg-rose-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm sm:text-base font-mono text-rose-600 font-extrabold">
                <FileText className="w-5 h-5" />
                <span>FILE PDF CƠ QUAN THUẾ CÔNG BỐ CỦA NGƯỜI BÁN · {pdfAttachment.formCode}</span>
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-slate-900">
                {pdfAttachment.fileName} · {pdfAttachment.documentNumber}
              </div>
              <div className="text-base text-slate-700">
                Ban hành bởi: <strong className="text-slate-900">{pdfAttachment.issuingAuthority}</strong> · Ngày công bố:{' '}
                <strong className="text-slate-900 font-mono">{pdfAttachment.publishedDate}</strong>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowSellerPdfViewer((v) => !v)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 border text-base font-bold rounded-xl transition-colors cursor-pointer ${
                  showSellerPdfViewer
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <Eye className="w-4 h-4" />
                <span>{showSellerPdfViewer ? 'Đang mở Trình xem PDF gốc' : 'Trình xem PDF gốc'}</span>
              </button>
              <a
                href={`${pdfAttachment.pdfUrl}&download=1`}
                download={pdfAttachment.fileName}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold rounded-xl transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Tải File PDF Công bố (.PDF)</span>
              </a>
            </div>
          </div>
          {showSellerPdfViewer ? (
            <OfficialPdfViewer
              record={extractionResult.enterpriseRecord}
              pdfAttachment={pdfAttachment}
            />
          ) : (
            <div className="p-6 sm:p-8 text-base text-slate-800 space-y-2.5 bg-white leading-relaxed">
              <p className="font-bold text-slate-900">{pdfAttachment.officialSummary}</p>
              <ul className="space-y-2 text-slate-700">
                {extractionResult.enterpriseRecord.riskReasons.map((b: string, i: number) => (
                  <li key={i}>· {b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
