import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupEnterpriseRisk,
  formatSingleLookupMarkdown,
  parseAndEvaluateInvoice,
  parseBatchSupplierCsv,
  runDaily0630BatchScan,
  classifyTaxStatus,
  consolidateMultiSourceTaxStatus,
  normalizePostMergerAddress,
  formatNumericCharterCapital,
  inferTaxAuthorityFromAddress,
  SAMPLE_TT78_INVOICES,
  WatchlistEntry,
} from './taxEngine';

test('lookupEnterpriseRisk identifies safe, warning, and high-risk enterprises (including 0317464466) and attaches Tax Authority PDF', () => {
  const safeEnt = lookupEnterpriseRisk('0100109106');
  assert.equal(safeEnt.legalStatus, 'Đang hoạt động');
  assert.equal(safeEnt.riskConclusion, 'AN TOÀN');
  assert.equal(safeEnt.taxAuthorityPdf, undefined);
  assert.equal(safeEnt.charterCapital, '304.600.000.000.000 VNĐ');

  const locLong = lookupEnterpriseRisk('0317464466');
  assert.equal(locLong.companyName, 'CÔNG TY TNHH DỊCH VỤ VẬN TẢI LỘC LONG');
  assert.equal(locLong.legalStatus, 'Không hoạt động tại địa chỉ đăng ký');
  assert.equal(locLong.riskConclusion, 'NGUY CƠ CAO');
  assert.equal(locLong.schemaRiskLevel, 'CRITICAL');
  assert.ok(locLong.taxAuthorityPdf !== undefined);
  assert.equal(locLong.taxAuthorityPdf.fileName, 'ThongBao_CoQuanThue_0317464466.pdf');
  assert.ok(Array.isArray(locLong.crossCheckSteps));
  assert.equal(locLong.crossCheckSteps.length, 4);
  assert.equal(locLong.crossCheckSteps[0].riskEvaluation, 'NGUY CƠ CAO');

  const traGiang = lookupEnterpriseRisk('0313893048');
  assert.equal(
    traGiang.address,
    '208 Hà Huy Tập, Khu Nam Thiên 3, Phường Tân Hưng, Thành phố Hồ Chí Minh, Việt Nam'
  );
  assert.equal(traGiang.charterCapital, '15.000.000.000 VNĐ');
  assert.equal(
    traGiang.taxAuthority,
    'Đội Thuế liên huyện Quận 7 - Nhà Bè (Chi cục Thuế Khu vực II - TP. Hồ Chí Minh)'
  );

  const highRiskEnt = lookupEnterpriseRisk('0316928415');
  assert.equal(highRiskEnt.legalStatus, 'Không hoạt động tại địa chỉ đăng ký');
  assert.equal(highRiskEnt.riskConclusion, 'NGUY CƠ CAO');
  assert.ok(highRiskEnt.taxAuthorityPdf !== undefined);
  assert.equal(highRiskEnt.taxAuthorityPdf.fileName, 'ThongBao_CoQuanThue_0316928415.pdf');
  assert.ok(highRiskEnt.taxAuthorityPdf.pdfUrl.includes('/api/tax/official-pdf?'));

  const warningEnt = lookupEnterpriseRisk('0314892104');
  assert.equal(warningEnt.legalStatus, 'Tạm ngừng kinh doanh');
  assert.equal(warningEnt.riskConclusion, 'CẢNH BÁO');
  assert.ok(warningEnt.taxAuthorityPdf !== undefined);
});

test('normalizePostMergerAddress, formatNumericCharterCapital, and inferTaxAuthorityFromAddress work accurately', () => {
  const postMerger = normalizePostMergerAddress(
    '208 Hà Huy Tập, Khu Nam Thiên 3, Phường Tân Phong, Quận 7, Thành phố Hồ Chí Minh, Việt Nam Địa chỉ mới: 208 Hà Huy Tập, Khu Nam Thiên 3, Phường Tân Hưng, Thành phố Hồ Chí Minh, Việt Nam Thông tin xuất hóa đơn'
  );
  assert.equal(
    postMerger,
    '208 Hà Huy Tập, Khu Nam Thiên 3, Phường Tân Hưng, Thành phố Hồ Chí Minh, Việt Nam'
  );

  assert.equal(formatNumericCharterCapital('9.158,52 tỷ đồng', '0314928172'), '9.158.520.000.000 VNĐ');
  assert.equal(formatNumericCharterCapital('15 tỷ', '0313893048'), '15.000.000.000 VNĐ');

  const auth = inferTaxAuthorityFromAddress(
    postMerger,
    '0313893048',
    'Thuế cơ sở 7 Thành phố Hồ Chí Minh'
  );
  assert.equal(auth, 'Đội Thuế liên huyện Quận 7 - Nhà Bè (Chi cục Thuế Khu vực II - TP. Hồ Chí Minh)');
});

test('classifyTaxStatus and consolidateMultiSourceTaxStatus map and prioritize high-risk tax statuses accurately', () => {
  const active = classifyTaxStatus('Đang hoạt động (đã được cấp GCN ĐKT)');
  assert.equal(active.legalStatus, 'Đang hoạt động');
  assert.equal(active.riskConclusion, 'AN TOÀN');

  const absconded = classifyTaxStatus('NNT không hoạt động tại địa chỉ đã đăng ký');
  assert.equal(absconded.legalStatus, 'Không hoạt động tại địa chỉ đăng ký');
  assert.equal(absconded.riskConclusion, 'NGUY CƠ CAO');

  const suspended = classifyTaxStatus('Tạm ngừng kinh doanh có thời hạn');
  assert.equal(suspended.legalStatus, 'Tạm ngừng kinh doanh');
  assert.equal(suspended.riskConclusion, 'CẢNH BÁO');

  // Conservative consensus: if GDT reports "NNT không hoạt động tại địa chỉ đã đăng ký" and another source is blank or says "Đang hoạt động", NGUY CƠ CAO wins
  const consensus = consolidateMultiSourceTaxStatus([
    'Đang hoạt động',
    'NNT không hoạt động tại địa chỉ đã đăng ký',
    undefined,
  ]);
  assert.equal(consensus.classified.legalStatus, 'Không hoạt động tại địa chỉ đăng ký');
  assert.equal(consensus.classified.riskConclusion, 'NGUY CƠ CAO');
});

test('formatSingleLookupMarkdown outputs required sections and attached PDF info', () => {
  const record = lookupEnterpriseRisk('0316928415');
  const md = formatSingleLookupMarkdown(record);
  assert.ok(md.includes('Thông tin cơ bản'));
  assert.ok(md.includes('Trạng thái pháp lý'));
  assert.ok(md.includes('[Không hoạt động tại địa chỉ đăng ký]'));
  assert.ok(md.includes('[NGUY CƠ CAO]'));
  assert.ok(md.includes('File PDF Công bố của Cơ quan Thuế Đính kèm'));
  assert.ok(md.includes('ThongBao_CoQuanThue_0316928415.pdf'));
});

test('parseAndEvaluateInvoice accurately extracts Circular 78 XML tags and evaluates seller risk', () => {
  const safeXml = SAMPLE_TT78_INVOICES[0];
  const safeResult = parseAndEvaluateInvoice(safeXml.fileName, safeXml.content);
  assert.equal(safeResult.sellerMst, '0100109106');
  assert.equal(safeResult.invoiceSymbol, '1C26TAA');
  assert.equal(safeResult.invoiceNumber, '0004819');
  assert.equal(safeResult.subtotalAmount, 85000000);
  assert.equal(safeResult.vatAmount, 8500000);
  assert.equal(safeResult.totalAmount, 93500000);
  assert.equal(safeResult.recommendation, 'Đủ điều kiện khấu trừ');

  const riskyXml = SAMPLE_TT78_INVOICES[1];
  const riskyResult = parseAndEvaluateInvoice(riskyXml.fileName, riskyXml.content);
  assert.equal(riskyResult.sellerMst, '0316928415');
  assert.equal(riskyResult.sellerMstEvaluation, 'Nguy cơ cao');
  assert.equal(riskyResult.recommendation, 'Rủi ro loại trừ');

  // Test plain text extracted from PDF invoice (including spaced MST, Buyer MST section, and PDF xref lines)
  const pdfTextInvoice = [
    '0000000000 65535 f',
    '0000000016 00000 n',
    'HÓA ĐƠN GIÁ TRỊ GIA TĂNG',
    'Ký hiệu (Series):\n1C26TGN',
    'Số (Invoice No.):\n0002845',
    'Ngày 10 tháng 11 năm 2026',
    'Đơn vị bán hàng (Seller): CÔNG TY TNHH DỊCH VỤ VẬN TẢI LỘC LONG',
    'Mã số thuế (Tax code): 0 3 1 7 4 6 4 4 6 6',
    'Họ tên người mua hàng (Buyer): Nguyễn Văn Mua',
    'Tên đơn vị (Company name): TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
    'Mã số thuế (Tax code): 0100109106',
    'Cộng tiền hàng (Total amount):\n120.000.000',
    'Tiền thuế GTGT (VAT amount):\n12.000.000',
    'Tổng cộng tiền thanh toán (Total payment):\n132.000.000',
  ].join('\n');
  const pdfResult = parseAndEvaluateInvoice('HoaDon_LocLong.pdf', pdfTextInvoice);
  assert.equal(pdfResult.sellerMst, '0317464466');
  assert.equal(pdfResult.sellerName, 'CÔNG TY TNHH DỊCH VỤ VẬN TẢI LỘC LONG');
  assert.equal(pdfResult.invoiceSymbol, '1C26TGN');
  assert.equal(pdfResult.invoiceNumber, '0002845');
  assert.equal(pdfResult.issueDate, '2026-11-10');
  assert.equal(pdfResult.subtotalAmount, 120000000);
  assert.equal(pdfResult.vatAmount, 12000000);
  assert.equal(pdfResult.totalAmount, 132000000);
  assert.equal(pdfResult.recommendation, 'Rủi ro loại trừ');
});

test('parseBatchSupplierCsv supports 3-column (Số thứ tự, Mã số thuế, Tên doanh nghiệp), Excel-quoted lines, and 9-digit MSTs without merging columns', () => {
  const sampleCsv = [
    'Số thứ tự,Mã số thuế,Tên doanh nghiệp',
    '1,0100109106,"Tập đoàn Công nghiệp - Viễn thông Quân đội (Viettel)"',
    '"2,0317464466,CÔNG TY TNHH DỊCH VỤ VẬN TẢI LỘC LONG"',
    '3;316928415;Công ty TNHH TM VLXD Đại Phát Thịnh',
    '4,,',
  ].join('\n');

  const rows = parseBatchSupplierCsv(sampleCsv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].stt, '1');
  assert.equal(rows[0].mst, '0100109106');
  assert.equal(rows[0].riskConclusion, 'AN TOÀN');
  assert.equal(rows[1].stt, '2');
  assert.equal(rows[1].mst, '0317464466');
  assert.equal(rows[1].riskConclusion, 'NGUY CƠ CAO');
  assert.equal(rows[2].stt, '3');
  assert.equal(rows[2].mst, '0316928415');
  assert.equal(rows[2].riskConclusion, 'NGUY CƠ CAO');
});

test('runDaily0630BatchScan detects state deltas and produces exact JSON schema and email alert', () => {
  const watchlist: WatchlistEntry[] = [
    {
      id: 'w1',
      userId: 'u1',
      mst: '0100109106',
      companyName: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
      baselineStatus: 'Đang hoạt động',
      currentStatus: 'Đang hoạt động',
      riskLevel: 'SAFE',
      riskReason: 'Bình thường',
      taxAuthority: 'Cục Thuế DNL',
      address: 'Hà Nội',
      note: '',
      impactedInvoices: ['1C26TAA-0004819'],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'w2',
      userId: 'u1',
      mst: '0316928415',
      companyName: 'CÔNG TY TNHH THƯƠNG MẠI VẬT LIỆU XÂY DỰNG ĐẠI PHÁT THỊNH',
      baselineStatus: 'Đang hoạt động',
      currentStatus: 'Không hoạt động tại địa chỉ đăng ký',
      riskLevel: 'CRITICAL',
      riskReason: 'Thuộc diện rủi ro cao về hóa đơn theo Thông báo của Cơ quan Thuế',
      taxAuthority: 'Chi cục Thuế Quận 12',
      address: 'TP.HCM',
      note: '',
      impactedInvoices: ['1C26TDP-0000912', '1C26TDP-0000955'],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-11T06:30:00Z',
    },
  ];

  const { payload, emailAlert } = runDaily0630BatchScan('le.ng.hoang.quan@gmail.com', watchlist, '2026-11-11');
  assert.equal(payload.user_email, 'le.ng.hoang.quan@gmail.com');
  assert.equal(payload.scan_timestamp, '2026-11-11 06:30:00');
  assert.equal(payload.alerts_detected, true);
  assert.equal(payload.changes.length, 1);
  assert.equal(payload.changes[0].mst, '0316928415');
  assert.equal(payload.changes[0].previous_status, 'Đang hoạt động');
  assert.equal(payload.changes[0].current_status, 'Không hoạt động tại địa chỉ đăng ký');
  assert.equal(payload.changes[0].risk_level, 'CRITICAL');
  assert.deepEqual(payload.changes[0].impacted_invoices, ['1C26TDP-0000912', '1C26TDP-0000955']);
  assert.ok(emailAlert !== null);
  assert.ok(emailAlert.bodyMarkdown.includes('0316928415'));
});

