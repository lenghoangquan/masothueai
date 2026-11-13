import test from 'node:test';
import assert from 'node:assert/strict';

interface AuthContext {
  uid: string;
  email_verified: boolean;
}

interface WatchlistPayload {
  userId: string;
  mst: string;
  companyName: string;
  baselineStatus: string;
  currentStatus: string;
  riskLevel: string;
  riskReason: string;
  taxAuthority: string;
  address: string;
  note: string;
  impactedInvoices: unknown[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const SERVER_TIME = '2026-11-11T06:30:00Z';

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

function isValidWatchlistSupplier(data: WatchlistPayload, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const requiredKeys = [
    'userId',
    'mst',
    'companyName',
    'baselineStatus',
    'currentStatus',
    'riskLevel',
    'riskReason',
    'taxAuthority',
    'address',
    'note',
    'impactedInvoices',
    'createdAt',
    'updatedAt',
  ];
  const keys = Object.keys(data);
  if (!requiredKeys.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => requiredKeys.includes(k))) return false;

  if (typeof data.userId !== 'string' || data.userId !== auth.uid) return false;
  if (typeof data.mst !== 'string' || data.mst.length < 10 || data.mst.length > 14 || !/^[0-9\-]+$/.test(data.mst)) return false;
  if (typeof data.companyName !== 'string' || data.companyName.length < 1 || data.companyName.length > 300) return false;
  if (typeof data.baselineStatus !== 'string' || data.baselineStatus.length < 1 || data.baselineStatus.length > 150) return false;
  if (typeof data.currentStatus !== 'string' || data.currentStatus.length < 1 || data.currentStatus.length > 150) return false;
  if (!['SAFE', 'WARNING', 'HIGH', 'CRITICAL'].includes(data.riskLevel)) return false;
  if (typeof data.riskReason !== 'string' || data.riskReason.length < 1 || data.riskReason.length > 1000) return false;
  if (typeof data.taxAuthority !== 'string' || data.taxAuthority.length < 1 || data.taxAuthority.length > 250) return false;
  if (typeof data.address !== 'string' || data.address.length < 1 || data.address.length > 500) return false;
  if (typeof data.note !== 'string' || data.note.length > 500) return false;
  if (!Array.isArray(data.impactedInvoices) || data.impactedInvoices.length > 50) return false;
  if (data.impactedInvoices.length > 0 && (typeof data.impactedInvoices[0] !== 'string' || data.impactedInvoices[0].length > 50)) return false;

  return true;
}

function evaluateCreateWatchlist(docId: string, payload: WatchlistPayload, auth: AuthContext | null): 'ALLOWED' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(docId)) return 'PERMISSION_DENIED';
  if (!isValidWatchlistSupplier(payload, auth)) return 'PERMISSION_DENIED';
  if (payload.createdAt !== SERVER_TIME || payload.updatedAt !== SERVER_TIME) return 'PERMISSION_DENIED';
  return 'ALLOWED';
}

function evaluateUpdateWatchlist(
  docId: string,
  existing: WatchlistPayload,
  incoming: WatchlistPayload,
  auth: AuthContext | null
): 'ALLOWED' | 'PERMISSION_DENIED' {
  if (!auth || !auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(docId)) return 'PERMISSION_DENIED';
  if (!isValidWatchlistSupplier(incoming, auth)) return 'PERMISSION_DENIED';
  if (existing.userId !== auth.uid) return 'PERMISSION_DENIED';
  if (incoming.userId !== existing.userId) return 'PERMISSION_DENIED';
  if (incoming.mst !== existing.mst) return 'PERMISSION_DENIED';
  if (incoming.baselineStatus !== existing.baselineStatus) return 'PERMISSION_DENIED';
  if (incoming.createdAt !== existing.createdAt) return 'PERMISSION_DENIED';
  if (incoming.updatedAt !== SERVER_TIME) return 'PERMISSION_DENIED';
  return 'ALLOWED';
}

const validAuth: AuthContext = { uid: 'user_123', email_verified: true };

const baseValidPayload: WatchlistPayload = {
  userId: 'user_123',
  mst: '0100109106',
  companyName: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
  baselineStatus: 'Đang hoạt động',
  currentStatus: 'Đang hoạt động',
  riskLevel: 'SAFE',
  riskReason: 'Hoạt động bình thường, không thuộc danh sách cảnh báo.',
  taxAuthority: 'Cục Thuế Doanh nghiệp lớn',
  address: 'Lô D26 Khu đô thị mới Cầu Giấy, Hà Nội',
  note: 'Nhà cung cấp viễn thông',
  impactedInvoices: ['1C26TAA-0001254'],
  createdAt: SERVER_TIME,
  updatedAt: SERVER_TIME,
};

test('Dirty Dozen Security Payloads all return PERMISSION_DENIED', () => {
  // 1. Unauthenticated Write
  assert.equal(evaluateCreateWatchlist('item_1', baseValidPayload, null), 'PERMISSION_DENIED');

  // 2. Unverified Email Spoof
  assert.equal(evaluateCreateWatchlist('item_1', baseValidPayload, { uid: 'user_123', email_verified: false }), 'PERMISSION_DENIED');

  // 3. Identity Spoofing on Create
  assert.equal(
    evaluateCreateWatchlist('item_1', { ...baseValidPayload, userId: 'victim_999' }, validAuth),
    'PERMISSION_DENIED'
  );

  // 4. Shadow Field Injection on Create
  assert.equal(
    evaluateCreateWatchlist('item_1', { ...baseValidPayload, isAdmin: true }, validAuth),
    'PERMISSION_DENIED'
  );

  // 5. ID Poisoning Attack
  assert.equal(evaluateCreateWatchlist('invalid/id$!', baseValidPayload, validAuth), 'PERMISSION_DENIED');

  // 6. Denial-of-Wallet String Overflow
  assert.equal(
    evaluateCreateWatchlist('item_1', { ...baseValidPayload, riskReason: 'X'.repeat(1500) }, validAuth),
    'PERMISSION_DENIED'
  );

  // 7. Unbounded Array Overflow
  assert.equal(
    evaluateCreateWatchlist(
      'item_1',
      { ...baseValidPayload, impactedInvoices: Array.from({ length: 60 }, (_, i) => `INV-${i}`) },
      validAuth
    ),
    'PERMISSION_DENIED'
  );

  // 8. Timestamp Forgery on Create
  assert.equal(
    evaluateCreateWatchlist('item_1', { ...baseValidPayload, createdAt: '2020-01-01T00:00:00Z' }, validAuth),
    'PERMISSION_DENIED'
  );

  // 9. Immutable Baseline Mutation on Update
  assert.equal(
    evaluateUpdateWatchlist(
      'item_1',
      baseValidPayload,
      { ...baseValidPayload, baselineStatus: 'Tampered Baseline' },
      validAuth
    ),
    'PERMISSION_DENIED'
  );

  // 10. Update-Gap Type Poisoning
  assert.equal(
    evaluateUpdateWatchlist(
      'item_1',
      baseValidPayload,
      { ...baseValidPayload, currentStatus: '' },
      validAuth
    ),
    'PERMISSION_DENIED'
  );

  // 11. Cross-Tenant Update Attempt
  assert.equal(
    evaluateUpdateWatchlist('item_1', baseValidPayload, baseValidPayload, { uid: 'attacker_777', email_verified: true }),
    'PERMISSION_DENIED'
  );

  // 12. Invalid Risk Level Enum Injection
  assert.equal(
    evaluateCreateWatchlist('item_1', { ...baseValidPayload, riskLevel: 'SUPER_SAFE' }, validAuth),
    'PERMISSION_DENIED'
  );

  // Verify valid payload succeeds
  assert.equal(evaluateCreateWatchlist('item_1', baseValidPayload, validAuth), 'ALLOWED');
});
