import React, { useState, useEffect, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  BellRing,
  UserCheck,
  X,
  Sparkles,
  Search,
  FileCheck2,
  FileSpreadsheet,
  ShieldAlert,
  ShieldCheck,
  ChevronRight,
  Lock,
  Settings,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
} from './firebase';
import {
  EnterpriseTaxRecord,
  InvoiceExtractionResult,
  WatchlistEntry,
  LegalStatus,
  SchemaRiskLevel,
} from './utils/taxEngine';
import { LookupPanel } from './components/LookupPanel';
import { InvoiceExtractorPanel } from './components/InvoiceExtractorPanel';
import { BatchUploadPanel } from './components/BatchUploadPanel';
import { WatchlistScannerPanel } from './components/WatchlistScannerPanel';
import { SoftwareSettingsPanel } from './components/SoftwareSettingsPanel';
import { AdminControlPanel } from './components/AdminControlPanel';

type ActiveTab = 'lookup' | 'invoice' | 'batch' | 'watchlist' | 'settings' | 'admin';

const INITIAL_DEMO_WATCHLIST: WatchlistEntry[] = [
  {
    id: 'wl_0316928415',
    userId: 'demo_google_user',
    mst: '0316928415',
    companyName: 'CÔNG TY TNHH TM VLXD ĐẠI PHÁT THỊNH',
    baselineStatus: 'Đang hoạt động',
    currentStatus: 'Không hoạt động tại địa chỉ đăng ký',
    riskLevel: 'CRITICAL',
    riskReason: 'Có Thông báo về việc người nộp thuế không hoạt động tại địa chỉ đã đăng ký (Mẫu số 16/TB-ĐKT).',
    taxAuthority: 'Đội Thuế Quận 12 - Chi cục Thuế Khu vực II (TP. Hồ Chí Minh)',
    address: '45/12 Tô Ngọc Vân, Phường Thới An, Thành phố Hồ Chí Minh, Việt Nam',
    note: 'Vật liệu xây dựng Q3',
    impactedInvoices: ['1C26TDP-0000912', '1C26TDP-0000955'],
    createdAt: '2026-08-15T09:15:00Z',
    updatedAt: '2026-11-11T06:30:00Z',
  },
  {
    id: 'wl_0314892104',
    userId: 'demo_google_user',
    mst: '0314892104',
    companyName: 'CÔNG TY TNHH DV VẬN TẢI & LOGISTICS Á CHÂU',
    baselineStatus: 'Đang hoạt động',
    currentStatus: 'Tạm ngừng kinh doanh',
    riskLevel: 'HIGH',
    riskReason: 'Doanh nghiệp chuyển sang Tạm ngừng kinh doanh có thời hạn.',
    taxAuthority: 'Đội Thuế Quận Bình Tân - Chi cục Thuế Khu vực II (TP. Hồ Chí Minh)',
    address: '284 Quốc lộ 1A, Phường Bình Hưng Hòa, Thành phố Hồ Chí Minh, Việt Nam',
    note: 'Vận tải kho miền Nam',
    impactedInvoices: ['1C26TAC-0002105'],
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-11-11T06:30:00Z',
  },
  {
    id: 'wl_0100109106',
    userId: 'demo_google_user',
    mst: '0100109106',
    companyName: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI (VIETTEL)',
    baselineStatus: 'Đang hoạt động',
    currentStatus: 'Đang hoạt động',
    riskLevel: 'SAFE',
    riskReason: 'Chấp hành tốt nghĩa vụ kê khai và nộp thuế điện tử.',
    taxAuthority: 'Chi cục Thuế Doanh nghiệp lớn - Cục Thuế',
    address: 'Lô D26 Khu Đô Thị Mới Cầu Giấy, Phường Cầu Giấy, Thành phố Hà Nội, Việt Nam',
    note: 'Hạ tầng kênh truyền',
    impactedInvoices: ['1C26TAA-0004819'],
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-11-11T06:30:00Z',
  },
];

const MODULE_ITEMS: {
  id: ActiveTab;
  title: string;
  subtitle: string;
  requiresAuth: boolean;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'lookup',
    title: 'Tra cứu Mã số thuế',
    subtitle: 'Kiểm tra pháp lý, địa chỉ sau sáp nhập & rủi ro DN',
    requiresAuth: false,
    icon: Search,
  },
  {
    id: 'invoice',
    title: 'Kiểm tra Hóa đơn',
    subtitle: 'Bóc tách & đối soát file hóa đơn PDF / XML',
    requiresAuth: true,
    icon: FileCheck2,
  },
  {
    id: 'batch',
    title: 'Quét Hàng loạt NCC',
    subtitle: 'Tải file mẫu & Upload file nhà cung cấp sau khi điền',
    requiresAuth: true,
    icon: FileSpreadsheet,
  },
  {
    id: 'watchlist',
    title: 'Danh sách theo dõi',
    subtitle: 'Giám sát biến động tự động & Cảnh báo Email',
    requiresAuth: true,
    icon: BellRing,
  },
  {
    id: 'settings',
    title: 'Cài đặt phần mềm',
    subtitle: 'Giới thiệu tác dụng phần mềm, hoạt động vì cộng đồng & Tùy chỉnh',
    requiresAuth: false,
    icon: Settings,
  },
  {
    id: 'admin',
    title: 'Quản trị viên (Admin)',
    subtitle: 'Admin Control, Chống DDoS & Tường lửa WAF chống Hack',
    requiresAuth: false,
    icon: ShieldAlert,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('lookup');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>(INITIAL_DEMO_WATCHLIST);
  const syncedFirestoreDocIdsRef = useRef<Set<string>>(new Set());

  const isAuthenticated = Boolean(firebaseUser);
  const currentUserEmail = firebaseUser?.email || '';
  const isSuperAdmin =
    isAuthenticated &&
    currentUserEmail.trim().toLowerCase() === 'le.ng.hoang.quan@gmail.com';
  const visibleModules = MODULE_ITEMS.filter(
    (mod) => mod.id !== 'admin' || isSuperAdmin
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeTab === 'admin' && !isSuperAdmin) {
      setActiveTab('lookup');
    }
  }, [activeTab, isSuperAdmin]);

  // Dynamic Canonical URL & Module Title SEO Synchronization for Google Search
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canonicalHref = window.location.origin + window.location.pathname;
    const canonicalEl = document.getElementById('canonical-url') as HTMLLinkElement | null;
    if (canonicalEl) {
      canonicalEl.href = canonicalHref;
    }
    const ogUrlEl = document.getElementById('og-url') as HTMLMetaElement | null;
    if (ogUrlEl) {
      ogUrlEl.content = canonicalHref;
    }

    const tabTitles: Record<ActiveTab, string> = {
      lookup: 'MASAOTHUE AI — Hệ thống Đối soát Tuân thủ Thuế & Quản trị Rủi ro Hóa đơn',
      invoice: 'Kiểm tra Hóa đơn Điện tử PDF/XML (TT78) | MASAOTHUE AI',
      batch: 'Quét Hàng loạt Mã số thuế Nhà cung cấp | MASAOTHUE AI',
      watchlist: 'Danh sách Theo dõi & Cảnh báo Rủi ro Thuế | MASAOTHUE AI',
      settings: 'Cài đặt Phần mềm & Sứ mệnh Vì Cộng đồng | MASAOTHUE AI',
      admin: 'Trung tâm Quản trị Hệ thống & Bảo mật Chống DDoS/WAF | MASAOTHUE AI',
    };
    document.title = tabTitles[activeTab];
  }, [activeTab]);

  useEffect(() => {
    if (!firebaseUser) {
      syncedFirestoreDocIdsRef.current.clear();
      return;
    }
    const watchlistPath = 'watchlist';
    const q = query(collection(db, watchlistPath), where('userId', '==', firebaseUser.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        syncedFirestoreDocIdsRef.current = new Set(snapshot.docs.map((d) => d.id));
        if (snapshot.empty) return;
        const loaded: WatchlistEntry[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            userId: String(data.userId || firebaseUser.uid),
            mst: String(data.mst || ''),
            companyName: String(data.companyName || ''),
            baselineStatus: String(data.baselineStatus || 'Đang hoạt động'),
            currentStatus: String(data.currentStatus || 'Đang hoạt động'),
            riskLevel: (data.riskLevel as SchemaRiskLevel) || 'SAFE',
            riskReason: String(data.riskReason || ''),
            taxAuthority: String(data.taxAuthority || ''),
            address: String(data.address || ''),
            note: String(data.note || ''),
            impactedInvoices: Array.isArray(data.impactedInvoices)
              ? data.impactedInvoices.map(String)
              : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
        setWatchlist(loaded);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, watchlistPath);
      }
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  const handleGooglePopupSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setAuthDialogOpen(false);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? `Không thể hoàn tất đăng nhập Google (${err.message}). Vui lòng cho phép cửa sổ bật lên (Popup) trên trình duyệt để đăng nhập bằng tài khoản Google.`
          : 'Không thể mở cửa sổ đăng nhập Google.'
      );
    }
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      await signOut(auth);
    }
    setActiveTab('lookup');
  };

  const handleAddToWatchlist = async (
    record: EnterpriseTaxRecord,
    invoiceNo?: string,
    note?: string
  ) => {
    const docId = `wl_${record.mst.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const existingEntry = watchlist.find((w) => w.mst === record.mst);

    const mergedInvoices = existingEntry
      ? Array.from(
          new Set([
            ...existingEntry.impactedInvoices,
            ...(invoiceNo ? [invoiceNo.slice(0, 50)] : []),
          ])
        ).slice(0, 50)
      : invoiceNo
      ? [invoiceNo.slice(0, 50)]
      : [];

    const baselineStatus = existingEntry ? existingEntry.baselineStatus : record.legalStatus;

    const updatedEntry: WatchlistEntry = {
      id: docId,
      userId: firebaseUser?.uid || 'demo_google_user',
      mst: record.mst.slice(0, 14),
      companyName: record.companyName.slice(0, 300),
      baselineStatus: baselineStatus.slice(0, 150),
      currentStatus: record.legalStatus.slice(0, 150),
      riskLevel: record.schemaRiskLevel,
      riskReason: (record.riskReasons[0] || 'Đối soát tự động').slice(0, 1000),
      taxAuthority: record.taxAuthority.slice(0, 250),
      address: record.address.slice(0, 500),
      note: (note ?? existingEntry?.note ?? '').slice(0, 500),
      impactedInvoices: mergedInvoices,
      createdAt: existingEntry?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setWatchlist((prev) => {
      const idx = prev.findIndex((item) => item.mst === record.mst);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedEntry;
        return copy;
      }
      return [updatedEntry, ...prev];
    });

    if (
      firebaseUser &&
      firebaseUser.emailVerified &&
      /^[0-9-]{10,14}$/.test(updatedEntry.mst)
    ) {
      const userDocId = `wl_${firebaseUser.uid.slice(0, 32)}_${record.mst.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const path = `watchlist/${userDocId}`;
      const existsInFirestore = syncedFirestoreDocIdsRef.current.has(userDocId);
      try {
        if (!existsInFirestore) {
          await setDoc(doc(db, 'watchlist', userDocId), {
            userId: firebaseUser.uid,
            mst: updatedEntry.mst,
            companyName: updatedEntry.companyName,
            baselineStatus: updatedEntry.baselineStatus,
            currentStatus: updatedEntry.currentStatus,
            riskLevel: updatedEntry.riskLevel,
            riskReason: updatedEntry.riskReason,
            taxAuthority: updatedEntry.taxAuthority,
            address: updatedEntry.address,
            note: updatedEntry.note,
            impactedInvoices: updatedEntry.impactedInvoices,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          syncedFirestoreDocIdsRef.current.add(userDocId);
        } else {
          await updateDoc(doc(db, 'watchlist', userDocId), {
            currentStatus: updatedEntry.currentStatus,
            riskLevel: updatedEntry.riskLevel,
            riskReason: updatedEntry.riskReason,
            impactedInvoices: updatedEntry.impactedInvoices,
            note: updatedEntry.note,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }
  };

  const handleInvoiceExtracted = async (
    invoice: InvoiceExtractionResult,
    enterprise: EnterpriseTaxRecord
  ) => {
    const fullInvoiceCode = `${invoice.invoiceSymbol}-${invoice.invoiceNumber}`;
    await handleAddToWatchlist(enterprise, fullInvoiceCode, `HĐ ${invoice.fileName}`);

    const cleanSellerMst = invoice.sellerMst.replace(/[^0-9-]/g, '').slice(0, 14);
    if (
      firebaseUser &&
      firebaseUser.emailVerified &&
      cleanSellerMst.length >= 10
    ) {
      const invDocId = `inv_${firebaseUser.uid.slice(0, 20)}_${cleanSellerMst}_${Date.now()}`.replace(
        /[^a-zA-Z0-9_-]/g,
        ''
      );
      try {
        await setDoc(doc(db, 'invoices', invDocId), {
          userId: firebaseUser.uid,
          sellerMst: cleanSellerMst,
          sellerName: (invoice.sellerName || enterprise.companyName || 'Doanh nghiệp').slice(0, 300),
          invoiceSymbol: (invoice.invoiceSymbol || '1C26TAA').slice(0, 30),
          invoiceNumber: (invoice.invoiceNumber || '0000001').slice(0, 30),
          issueDate: (invoice.issueDate && invoice.issueDate.length >= 8 ? invoice.issueDate : '2026-01-01').slice(0, 25),
          subtotalAmount: Math.max(0, Number(invoice.subtotalAmount) || 0),
          vatAmount: Math.max(0, Number(invoice.vatAmount) || 0),
          totalAmount: Math.max(0, Number(invoice.totalAmount) || 0),
          recommendation: invoice.recommendationCode,
          fileName: (invoice.fileName || 'HoaDon.pdf').slice(0, 200),
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `invoices/${invDocId}`);
      }
    }
  };

  const handleBatchSyncWatchlist = async (
    items: { record: EnterpriseTaxRecord; invoiceNo?: string; note?: string }[]
  ) => {
    for (const item of items) {
      await handleAddToWatchlist(item.record, item.invoiceNo, item.note);
    }
  };

  const handleSimulateStatusChange = async (
    itemId: string,
    newStatus: LegalStatus,
    newRiskLevel: SchemaRiskLevel,
    newReason: string
  ) => {
    setWatchlist((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              currentStatus: newStatus,
              riskLevel: newRiskLevel,
              riskReason: newReason,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  };

  const handleRemoveWatchlistItem = async (itemId: string) => {
    setWatchlist((prev) => prev.filter((item) => item.id !== itemId));
    if (firebaseUser && firebaseUser.emailVerified) {
      try {
        await deleteDoc(doc(db, 'watchlist', itemId));
      } catch {
        // Ignore if local item
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col futuristic-grid-bg text-slate-900">
      {/* Top Bar without horizontal module navigation: only Brand and "Đăng ký cảnh báo tự động" */}
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-xl px-6 sm:px-8 py-4 flex items-center justify-between gap-8 sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('lookup');
          }}
          className="text-2xl font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          MASOTHUE AI
        </a>

        <div className="flex items-center gap-3 shrink-0">
          {isAuthenticated ? (
            <button
              type="button"
              data-testid="auto-alert-auth-btn"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2.5 px-5 py-2.5 text-sm sm:text-base font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserCheck className="w-5 h-5" />
              <span>Đã đăng ký cảnh báo ({currentUserEmail.split('@')[0]}) · Thoát</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="auto-alert-auth-btn"
              onClick={() => setAuthDialogOpen(true)}
              className="inline-flex items-center gap-2.5 px-5 py-2.5 text-sm sm:text-base font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-md shadow-blue-600/25 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-5 h-5" />
              <span>Đăng ký cảnh báo tự động</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace with Large, Impressive Left Vertical Module Sidebar */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        {/* Left Vertical Sidebar for Modules (Larger, More Impressive Module Headings) */}
        <aside
          aria-label="Danh mục Hệ thống"
          data-testid="left-module-sidebar"
          className="w-full lg:w-[370px] shrink-0 lg:sticky lg:top-24"
        >
          <div className="futuristic-surface rounded-3xl p-6 border border-blue-200/90 shadow-xl shadow-blue-900/5">
            <div className="pb-4 mb-5 border-b border-slate-200/90 space-y-1">
              <div
                data-testid="sidebar-system-title"
                className="text-lg sm:text-xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 bg-clip-text text-transparent leading-snug"
              >
                Hệ thống nghiệp vụ kiểm tra
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                Danh mục
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              {visibleModules.map((mod) => {
                const IconComponent = mod.icon;
                const isActive = activeTab === mod.id;
                const isLocked = mod.requiresAuth && !isAuthenticated;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    data-testid={`sidebar-module-${mod.id}`}
                    onClick={() => setActiveTab(mod.id)}
                    className={`group w-full text-left p-5 rounded-2xl transition-all cursor-pointer border-2 ${
                      isActive
                        ? 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 text-white border-blue-600 shadow-xl shadow-blue-600/30 scale-[1.01]'
                        : 'bg-white hover:bg-blue-50/70 text-slate-900 border-slate-200 hover:border-blue-400 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                          isActive
                            ? 'bg-white/20 text-white border border-white/30 shadow-inner'
                            : 'bg-blue-50 text-blue-600 border border-blue-200'
                        }`}
                      >
                        <IconComponent className="w-7 h-7" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`text-lg sm:text-xl font-extrabold leading-snug tracking-tight ${
                              isActive ? 'text-white' : 'text-slate-900'
                            }`}
                          >
                            {mod.title}
                          </div>
                          {isLocked ? (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 mt-1 ${
                                isActive ? 'text-amber-200' : 'text-amber-600'
                              }`}
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Cần đăng nhập</span>
                            </span>
                          ) : (
                            <ChevronRight
                              className={`w-5 h-5 shrink-0 mt-1 transition-transform ${
                                isActive
                                  ? 'text-white translate-x-0.5'
                                  : 'text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5'
                              }`}
                            />
                          )}
                        </div>
                        <div
                          className={`text-sm sm:text-[15px] mt-1.5 leading-relaxed font-medium ${
                            isActive ? 'text-blue-50' : 'text-slate-600'
                          }`}
                        >
                          {mod.subtitle}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Primary Module Workspace */}
        <main className="flex-1 min-w-0 w-full">
          {activeTab === 'lookup' && (
            <LookupPanel
              onAddToWatchlist={handleAddToWatchlist}
            />
          )}

          {activeTab === 'invoice' && (
            <InvoiceExtractorPanel
              isAuthenticated={isAuthenticated}
              onGoogleSignIn={() => setAuthDialogOpen(true)}
              onInvoiceExtracted={handleInvoiceExtracted}
            />
          )}

          {activeTab === 'batch' && (
            <BatchUploadPanel
              isAuthenticated={isAuthenticated}
              onGoogleSignIn={() => setAuthDialogOpen(true)}
              onBatchSyncWatchlist={handleBatchSyncWatchlist}
            />
          )}

          {activeTab === 'watchlist' && (
            <WatchlistScannerPanel
              isAuthenticated={isAuthenticated}
              userEmail={currentUserEmail}
              watchlist={watchlist}
              onGoogleSignIn={() => setAuthDialogOpen(true)}
              onSimulateStatusChange={handleSimulateStatusChange}
              onRemoveWatchlistItem={handleRemoveWatchlistItem}
            />
          )}

          {activeTab === 'settings' && <SoftwareSettingsPanel />}

          {activeTab === 'admin' && isSuperAdmin && (
            <AdminControlPanel
              isAuthenticated={isAuthenticated}
              userEmail={currentUserEmail}
              onGoogleSignIn={() => setAuthDialogOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Software Information Disclaimer at the Very Bottom (Miễn trừ trách nhiệm thông tin của phần mềm) */}
      <footer
        data-testid="software-disclaimer-footer"
        className="border-t border-slate-200/90 bg-white/95 px-4 sm:px-6 lg:px-8 py-6 mt-auto"
      >
        <div className="max-w-[1440px] mx-auto space-y-2.5">
          <div className="flex items-center gap-2.5 text-sm sm:text-base font-extrabold text-slate-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>MIỄN TRỪ TRÁCH NHIỆM THÔNG TIN CỦA PHẦN MỀM (DISCLAIMER)</span>
          </div>
          <p className="text-sm sm:text-[15px] text-slate-700 leading-relaxed">
            Thông tin mã số thuế, địa chỉ hành chính sau sáp nhập, người đại diện pháp luật, vốn điều lệ, cơ quan quản lý thuế và cảnh báo rủi ro trên phần mềm <strong>MASOTHUE AI</strong> được tổng hợp và đối chiếu tự động từ Cổng thông tin Đăng ký doanh nghiệp, Hệ thống Hóa đơn điện tử và các văn bản thông báo công khai của Cơ quan Thuế nhằm hỗ trợ bộ phận Kế toán - Thuế rà soát nội bộ. Kết quả trên phần mềm mang tính chất tham khảo nghiệp vụ và cảnh báo sớm, không thay thế văn bản kết luận thanh tra, kiểm tra chính thức của Cơ quan Thuế có thẩm quyền. Doanh nghiệp cần lưu trữ đầy đủ hợp đồng kinh tế, chứng từ thanh toán không dùng tiền mặt và hồ sơ gốc theo quy định của Luật Quản lý thuế hiện hành.
          </p>
        </div>
      </footer>

      {/* Automatic Alert Registration / Google Sign-In Modal */}
      {authDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="futuristic-surface rounded-2xl max-w-lg w-full p-7 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h2 id="auth-dialog-title" className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Đăng nhập bằng tài khoản Google
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthDialogOpen(false);
                  setAuthError(null);
                }}
                aria-label="Đóng"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-base text-slate-700 leading-relaxed">
              Vui lòng đăng nhập qua <strong>tài khoản Google</strong> để mở khóa <strong>Kiểm tra Hóa đơn</strong>, <strong>Quét Hàng loạt NCC</strong>, <strong>Danh sách theo dõi</strong> và nhận cảnh báo tự động.
            </p>

            <div
              data-testid="google-security-privacy-notice"
              className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200 flex items-start gap-3 text-sm sm:text-base text-emerald-950 leading-relaxed"
            >
              <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-extrabold text-emerald-900">Lưu ý bảo mật tuyệt đối:</strong> Đăng nhập tài khoản Google hoàn toàn bảo mật qua giao thức chính thức của Google. Website <strong>tuyệt đối không ghi nhận và không lưu trữ mật khẩu</strong> hay bất cứ thông tin bảo mật nào liên quan đến tài khoản của bạn.
              </div>
            </div>

            {authError && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm sm:text-base text-amber-800">
                {authError}
              </div>
            )}

            <button
              type="button"
              data-testid="modal-google-signin-btn"
              onClick={handleGooglePopupSignIn}
              className="w-full py-3.5 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-base font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all cursor-pointer"
            >
              Đăng nhập bằng tài khoản Google
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
