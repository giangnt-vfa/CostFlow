import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  LayoutGrid,
  List,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { ORDER_SOURCES, SHIPPING_CARRIERS } from '../data/initialSalesData';
import {
  CatalogItem,
  FulfillmentStatus,
  MenuItem,
  OrderSource,
  SalesOrder,
  ShippingCarrier,
} from '../types/costing';
import {
  formatNumber,
  formatVND,
  normalizeVietnamese,
  triggerDownloadCSV,
} from '../utils/formatters';
import {
  buildOrderConfirmationMessage,
  downloadOrderReceiptImage,
  exportSalesOrdersCSV,
  formatISODate,
  getEffectiveFulfillmentStatus,
  getOrderFinancials,
} from '../utils/salesAnalytics';
import { SalesOrderModal } from './SalesOrderModal';

interface SalesHistoryViewProps {
  salesOrders: SalesOrder[];
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  onAddSalesOrder: (order: Omit<SalesOrder, 'id'>) => void;
  onUpdateSalesOrder: (id: string, patch: Partial<SalesOrder>) => void;
  onDeleteSalesOrder: (id: string) => void;
}

type QuickFilterTab = 'today' | 'preorder' | 'unpaid' | 'completed' | 'cancelled' | 'all';

const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  delivering: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
};

const NEXT_STEP_CONFIG: Partial<
  Record<
    FulfillmentStatus,
    { next: FulfillmentStatus; label: string; buttonClass: string }
  >
> = {
  pending: {
    next: 'confirmed',
    label: 'Xác nhận đơn',
    buttonClass: 'bg-teal-700 hover:bg-teal-800 text-white',
  },
  confirmed: {
    next: 'delivering',
    label: 'Bắt đầu giao',
    buttonClass: 'bg-slate-900 hover:bg-slate-800 text-white',
  },
  delivering: {
    next: 'completed',
    label: 'Hoàn tất giao',
    buttonClass: 'bg-emerald-700 hover:bg-emerald-800 text-white',
  },
};

function getGoogleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function SalesHistoryView({
  salesOrders,
  menuItems,
  catalogMap,
  onAddSalesOrder,
  onUpdateSalesOrder,
  onDeleteSalesOrder,
}: SalesHistoryViewProps) {
  const todayISO = formatISODate(new Date());

  const [quickTab, setQuickTab] = useState<QuickFilterTab>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [carrierFilter, setCarrierFilter] = useState<ShippingCarrier | 'Tất cả'>('Tất cả');
  const [sourceFilter, setSourceFilter] = useState<OrderSource | 'Tất cả'>('Tất cả');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [visibleLimit, setVisibleLimit] = useState(40);

  // Modals & Drawer state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [duplicateOrder, setDuplicateOrder] = useState<SalesOrder | null>(null);

  // Inline quick actions & feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [inlineCarrierOrderId, setInlineCarrierOrderId] = useState<string | null>(null);
  const [inlineCarrier, setInlineCarrier] = useState<ShippingCarrier>('Xanh SM');
  const [inlineTrackingCode, setInlineTrackingCode] = useState('');

  // Drawer editable carrier tracking fields
  const [drawerCarrier, setDrawerCarrier] = useState<ShippingCarrier>('Tự giao');
  const [drawerTrackingCode, setDrawerTrackingCode] = useState('');

  const selectedOrder = useMemo(
    () => (selectedOrderId ? salesOrders.find((o) => o.id === selectedOrderId) ?? null : null),
    [salesOrders, selectedOrderId]
  );

  useEffect(() => {
    if (selectedOrder) {
      setDrawerCarrier(selectedOrder.carrier || 'Tự giao');
      setDrawerTrackingCode(selectedOrder.carrierTrackingCode || '');
    }
  }, [selectedOrder]);

  // Reset visible count when switching filters
  useEffect(() => {
    setVisibleLimit(40);
  }, [quickTab, searchQuery, carrierFilter, sourceFilter]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Clipboard blocked in some iframe contexts
    }
  };

  // Precompute solo-operator ops metrics across all orders
  const opsSummary = useMemo(() => {
    let todayOrders = 0;
    let todayUnits = 0;
    let todayPendingOrders = 0;
    let preorderCount = 0;
    let preorderUnits = 0;
    let unpaidCount = 0;
    let unpaidAmount = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    for (const o of salesOrders) {
      const fStatus = getEffectiveFulfillmentStatus(o);
      const delDate = o.deliveryDate || o.date;
      const fin = getOrderFinancials(o);

      if (fStatus === 'cancelled') {
        cancelledCount += 1;
        continue;
      }

      if (fStatus === 'completed') {
        completedCount += 1;
      }

      if (delDate === todayISO) {
        todayOrders += 1;
        todayUnits += fin.totalUnits;
        if (fStatus !== 'completed') {
          todayPendingOrders += 1;
        }
      }

      if (delDate > todayISO) {
        preorderCount += 1;
        preorderUnits += fin.totalUnits;
      }

      if (o.paymentStatus === 'unpaid') {
        unpaidCount += 1;
        unpaidAmount += fin.customerPayable;
      }
    }

    return {
      todayOrders,
      todayUnits,
      todayPendingOrders,
      preorderCount,
      preorderUnits,
      unpaidCount,
      unpaidAmount,
      completedCount,
      cancelledCount,
      allCount: salesOrders.length,
    };
  }, [salesOrders, todayISO]);

  // Filtered list matching quick tab + search + carrier + source
  const filteredOrders = useMemo(() => {
    const q = normalizeVietnamese(searchQuery.trim());
    return salesOrders
      .filter((o) => {
        const fStatus = getEffectiveFulfillmentStatus(o);
        const delDate = o.deliveryDate || o.date;

        if (quickTab === 'today') {
          if (fStatus === 'cancelled' || delDate !== todayISO) return false;
        } else if (quickTab === 'preorder') {
          if (fStatus === 'cancelled' || delDate <= todayISO) return false;
        } else if (quickTab === 'unpaid') {
          if (fStatus === 'cancelled' || o.paymentStatus !== 'unpaid') return false;
        } else if (quickTab === 'completed') {
          if (fStatus !== 'completed') return false;
        } else if (quickTab === 'cancelled') {
          if (fStatus !== 'cancelled') return false;
        }

        if (carrierFilter !== 'Tất cả' && (o.carrier || 'Tự giao') !== carrierFilter) {
          return false;
        }
        if (sourceFilter !== 'Tất cả' && o.source !== sourceFilter) {
          return false;
        }

        if (q) {
          const hay = normalizeVietnamese(
            [
              o.orderCode,
              o.carrier || '',
              o.carrierTrackingCode || '',
              o.customerName || '',
              o.customerPhone || '',
              o.customerAddress || '',
              o.source,
              o.deliveryZone,
              o.deliveryDate || o.date,
              o.note,
              ...o.items.map((it) => `${it.code} ${it.name}`),
            ].join(' ')
          );
          if (!hay.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Put active (non-completed) orders first inside Today / Pre-order queues
        if (quickTab === 'today' || quickTab === 'preorder') {
          const rank = (s: FulfillmentStatus) =>
            s === 'pending' ? 0 : s === 'confirmed' ? 1 : s === 'delivering' ? 2 : 3;
          const ra = rank(getEffectiveFulfillmentStatus(a));
          const rb = rank(getEffectiveFulfillmentStatus(b));
          if (ra !== rb) return ra - rb;
        }
        return (
          (b.deliveryDate || b.date).localeCompare(a.deliveryDate || a.date) ||
          b.date.localeCompare(a.date) ||
          b.orderCode.localeCompare(a.orderCode)
        );
      });
  }, [salesOrders, quickTab, carrierFilter, sourceFilter, searchQuery, todayISO]);

  // Filtered financial totals for 4th KPI card
  const filteredTotals = useMemo(() => {
    let netRevenue = 0;
    let grossProfit = 0;
    let totalUnits = 0;
    for (const o of filteredOrders) {
      if (o.status === 'cancelled') continue;
      const fin = getOrderFinancials(o);
      netRevenue += fin.net;
      grossProfit += fin.grossProfit;
      totalUnits += fin.totalUnits;
    }
    return { netRevenue, grossProfit, totalUnits };
  }, [filteredOrders]);

  // Customer purchase history for the currently opened Order Detail Drawer
  const customerHistory = useMemo(() => {
    if (!selectedOrder) return null;
    const phone = (selectedOrder.customerPhone || '').trim();
    const nameNorm = normalizeVietnamese((selectedOrder.customerName || '').trim());
    if (!phone && !nameNorm) return null;

    const matched = salesOrders.filter((o) => {
      if (o.status === 'cancelled') return false;
      if (phone && (o.customerPhone || '').trim() === phone) return true;
      if (!phone && nameNorm && normalizeVietnamese((o.customerName || '').trim()) === nameNorm) {
        return true;
      }
      return false;
    });

    let totalSpend = 0;
    const dishCounts = new Map<string, number>();
    for (const o of matched) {
      const fin = getOrderFinancials(o);
      totalSpend += fin.customerPayable;
      for (const it of o.items) {
        dishCounts.set(it.name, (dishCounts.get(it.name) || 0) + it.quantity);
      }
    }
    const favoriteDish = Array.from(dishCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      orderCount: matched.length,
      totalSpend,
      favoriteDish: favoriteDish || '—',
      recentOrders: matched.slice(0, 5),
    };
  }, [selectedOrder, salesOrders]);

  const handleAdvanceStatus = (order: SalesOrder) => {
    const current = getEffectiveFulfillmentStatus(order);
    const step = NEXT_STEP_CONFIG[current];
    if (!step) return;
    const patch: Partial<SalesOrder> = {
      fulfillmentStatus: step.next,
      status: 'completed',
    };
    // Auto-mark COD as paid if desired? Keep explicit payment toggle so COD debt stays accurate!
    onUpdateSalesOrder(order.id, patch);
  };

  const handleTogglePaymentStatus = (order: SalesOrder) => {
    if (order.status === 'cancelled') return;
    const nextStatus = order.paymentStatus === 'unpaid' ? 'paid' : 'unpaid';
    onUpdateSalesOrder(order.id, { paymentStatus: nextStatus });
  };

  const handleOpenInlineCarrier = (order: SalesOrder) => {
    setInlineCarrierOrderId(order.id);
    setInlineCarrier(order.carrier || 'Xanh SM');
    setInlineTrackingCode(order.carrierTrackingCode || '');
  };

  const handleSaveInlineCarrier = (orderId: string) => {
    onUpdateSalesOrder(orderId, {
      carrier: inlineCarrier,
      carrierTrackingCode: inlineTrackingCode.trim(),
    });
    setInlineCarrierOrderId(null);
  };

  const handleSaveDrawerCarrier = () => {
    if (!selectedOrder) return;
    onUpdateSalesOrder(selectedOrder.id, {
      carrier: drawerCarrier,
      carrierTrackingCode: drawerTrackingCode.trim(),
    });
    setCopiedKey('saved_carrier');
    setTimeout(() => setCopiedKey((p) => (p === 'saved_carrier' ? null : p)), 2000);
  };

  const handleOpenCreateModal = () => {
    setEditingOrder(null);
    setDuplicateOrder(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (order: SalesOrder) => {
    setDuplicateOrder(null);
    setEditingOrder(order);
    setModalOpen(true);
  };

  const handleOpenDuplicateModal = (order: SalesOrder) => {
    setEditingOrder(null);
    setDuplicateOrder(order);
    setModalOpen(true);
  };

  const handleExportCSV = () => {
    const csv = exportSalesOrdersCSV(filteredOrders);
    triggerDownloadCSV(`lich-su-ban-hang-${todayISO}.csv`, csv);
  };

  const QUICK_TABS: Array<{ id: QuickFilterTab; label: string; count: number }> = [
    { id: 'today', label: 'Cần giao hôm nay', count: opsSummary.todayOrders },
    { id: 'preorder', label: 'Đặt trước', count: opsSummary.preorderCount },
    { id: 'unpaid', label: 'Chưa thanh toán', count: opsSummary.unpaidCount },
    { id: 'completed', label: 'Hoàn tất', count: opsSummary.completedCount },
    { id: 'cancelled', label: 'Đã hủy', count: opsSummary.cancelledCount },
    { id: 'all', label: 'Tất cả đơn', count: opsSummary.allCount },
  ];

  const hasExtraFilters =
    searchQuery.trim().length > 0 || carrierFilter !== 'Tất cả' || sourceFilter !== 'Tất cả';

  return (
    <div className="space-y-6 pb-20 sm:pb-6">
      {/* Page Heading & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Lịch sử bán hàng &amp; Quản lý giao đơn
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Theo dõi lịch giao hôm nay, đơn đặt trước, đối soát COD và gán mã vận đơn Xanh SM, Grab Express, Ahamove.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Xuất CSV</span>
          </button>
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo đơn nhanh</span>
          </button>
        </div>
      </div>

      {/* 1. Solo-Operator Morning Ops KPI Strip (4 flat cards) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setQuickTab('today')}
          className={`text-left p-4 bg-white border rounded-xl transition-colors ${
            quickTab === 'today'
              ? 'border-teal-600 ring-1 ring-teal-600/20'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium text-slate-500">Cần giao hôm nay</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono-num text-2xl font-bold text-slate-900">
              {opsSummary.todayOrders} đơn
            </span>
            <span className="font-mono-num text-xs font-medium text-teal-700">
              {opsSummary.todayUnits} phần
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {opsSummary.todayPendingOrders > 0
              ? `Còn ${opsSummary.todayPendingOrders} đơn chưa giao xong`
              : 'Đã hoàn tất các đơn hôm nay'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setQuickTab('preorder')}
          className={`text-left p-4 bg-white border rounded-xl transition-colors ${
            quickTab === 'preorder'
              ? 'border-teal-600 ring-1 ring-teal-600/20'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium text-slate-500">Đặt trước (Pre-order)</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono-num text-2xl font-bold text-slate-900">
              {opsSummary.preorderCount} đơn
            </span>
            <span className="font-mono-num text-xs font-medium text-slate-600">
              {opsSummary.preorderUnits} phần
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Lịch hẹn các ngày tới cần chuẩn bị
          </div>
        </button>

        <button
          type="button"
          onClick={() => setQuickTab('unpaid')}
          className={`text-left p-4 bg-white border rounded-xl transition-colors ${
            quickTab === 'unpaid'
              ? 'border-amber-600 ring-1 ring-amber-600/20'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium text-slate-500">Chưa thu tiền / COD</div>
          <div className="mt-1.5 font-mono-num text-2xl font-bold text-amber-700 truncate">
            {formatVND(opsSummary.unpaidAmount, false)} đ
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {opsSummary.unpaidCount} đơn cần đối soát CK / thu hộ
          </div>
        </button>

        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <div className="text-xs font-medium text-slate-500">
            Lãi thực tế (theo bộ lọc)
          </div>
          <div
            className={`mt-1.5 font-mono-num text-2xl font-bold truncate ${
              filteredTotals.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {formatVND(filteredTotals.grossProfit, false)} đ
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-num truncate">
            DT thuần: {formatVND(filteredTotals.netRevenue, false)} đ · {filteredTotals.totalUnits} phần
          </div>
        </div>
      </section>

      {/* 2. Quick 1-Tap Filter Bar + Search & Carrier Filters */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {QUICK_TABS.map((tab) => {
            const active = quickTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setQuickTab(tab.id)}
                className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono-num text-[11px] ${
                    active ? 'text-teal-700 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mã đơn app (DH...), mã vận đơn (XSM, GRB, AHA...), tên, SĐT, địa chỉ, món..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={carrierFilter}
              onChange={(e) => setCarrierFilter(e.target.value as ShippingCarrier | 'Tất cả')}
              aria-label="Lọc theo đơn vị vận chuyển"
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="Tất cả">Tất cả ĐVVC</option>
              {SHIPPING_CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as OrderSource | 'Tất cả')}
              aria-label="Lọc theo nguồn đơn"
              className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="Tất cả">Tất cả nguồn đơn</option>
              {ORDER_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {hasExtraFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCarrierFilter('Tất cả');
                  setSourceFilter('Tất cả');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Xóa lọc</span>
              </button>
            )}

            <div className="hidden md:flex items-center p-0.5 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Xem dạng thẻ gọn"
                aria-label="Xem dạng thẻ gọn"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Xem dạng bảng đối soát"
                aria-label="Xem dạng bảng đối soát"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Orders List (Mobile-First Cards or Reconciliation Table) */}
      {filteredOrders.length === 0 ? (
        <section className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {quickTab === 'today'
              ? 'Hiện chưa có đơn cần giao hôm nay khớp bộ lọc'
              : 'Không tìm thấy đơn hàng nào khớp bộ lọc hiện tại'}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Tạo nhanh một đơn hàng online mới hoặc chuyển sang xem toàn bộ lịch sử đơn hàng.
          </p>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo đơn nhanh</span>
            </button>
            {quickTab !== 'all' && (
              <button
                type="button"
                onClick={() => setQuickTab('all')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <span>Xem tất cả {opsSummary.allCount} đơn</span>
              </button>
            )}
          </div>
        </section>
      ) : viewMode === 'cards' ? (
        <section className="space-y-3">
          {filteredOrders.slice(0, visibleLimit).map((order) => {
            const fin = getOrderFinancials(order);
            const fStatus = getEffectiveFulfillmentStatus(order);
            const nextStep = NEXT_STEP_CONFIG[fStatus];
            const isCancelled = fStatus === 'cancelled';
            const delDate = order.deliveryDate || order.date;
            const isEditingCarrier = inlineCarrierOrderId === order.id;

            const statusColorClass =
              fStatus === 'completed'
                ? 'text-emerald-700'
                : fStatus === 'cancelled'
                  ? 'text-red-600'
                  : fStatus === 'delivering'
                    ? 'text-teal-700'
                    : 'text-amber-700';

            return (
              <article
                key={order.id}
                className={`bg-white border rounded-xl p-4 sm:p-5 transition-colors ${
                  selectedOrderId === order.id
                    ? 'border-teal-600'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Row 1: Customer + Phone + Source + Dual Tracking Codes */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(order.id)}
                        className="font-display text-sm sm:text-base font-bold text-slate-900 hover:text-teal-700 text-left"
                      >
                        {order.customerName || 'Khách lẻ online'}
                      </button>

                      {order.customerPhone && (
                        <>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <a
                            href={`tel:${order.customerPhone}`}
                            className="inline-flex items-center gap-1 font-mono-num text-xs font-medium text-teal-700 hover:underline"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{order.customerPhone}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              void copyToClipboard(order.customerPhone!, `phone_${order.id}`)
                            }
                            className="text-slate-400 hover:text-slate-700 p-0.5"
                            title="Sao chép SĐT"
                            aria-label="Sao chép SĐT"
                          >
                            {copiedKey === `phone_${order.id}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      <span>{order.source}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">
                        Giao {delDate === todayISO ? 'Hôm nay' : delDate}
                        {order.deliverySlot ? ` (${order.deliverySlot})` : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${statusColorClass}`}>
                        {FULFILLMENT_LABELS[fStatus]}
                      </span>
                    </div>
                  </div>

                  {/* Dual Codes: App Order Code + Shipping Carrier & Tracking Code */}
                  <div className="flex flex-col sm:items-end gap-1 shrink-0 text-xs">
                    <div className="flex items-center gap-1.5 font-mono-num">
                      <span className="text-slate-400">App:</span>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(order.id)}
                        className="font-semibold text-slate-900 hover:text-teal-700"
                      >
                        {order.orderCode}
                      </button>
                    </div>

                    {!isEditingCarrier ? (
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{order.carrier || 'Tự giao'}</span>
                        {order.carrierTrackingCode ? (
                          <>
                            <span className="text-slate-300">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                void copyToClipboard(
                                  order.carrierTrackingCode!,
                                  `trk_${order.id}`
                                )
                              }
                              className="inline-flex items-center gap-1 font-mono-num font-semibold text-teal-800 hover:underline"
                              title="Nhấp để sao chép mã vận đơn"
                            >
                              <span>{order.carrierTrackingCode}</span>
                              {copiedKey === `trk_${order.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3 text-slate-400" />
                              )}
                            </button>
                          </>
                        ) : null}
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => handleOpenInlineCarrier(order)}
                            className="ml-1 text-[11px] font-medium text-teal-700 hover:underline whitespace-nowrap"
                          >
                            {order.carrierTrackingCode ? 'Sửa mã' : '+ Gán mã ship'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <select
                          value={inlineCarrier}
                          onChange={(e) => setInlineCarrier(e.target.value as ShippingCarrier)}
                          className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          {SHIPPING_CARRIERS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={inlineTrackingCode}
                          onChange={(e) => setInlineTrackingCode(e.target.value)}
                          placeholder="Mã Xanh SM / Grab / Aha..."
                          maxLength={80}
                          className="w-40 px-2 py-1 text-xs font-mono-num bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveInlineCarrier(order.id)}
                          className="px-2.5 py-1 text-xs font-medium bg-teal-700 hover:bg-teal-800 text-white rounded-md"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => setInlineCarrierOrderId(null)}
                          className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
                        >
                          Hủy
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Items Detail + Delivery Address & Note */}
                <div
                  onClick={() => setSelectedOrderId(order.id)}
                  className="py-3 space-y-1.5 cursor-pointer"
                >
                  <div className="text-sm text-slate-900 font-medium leading-snug">
                    {order.items.map((it, idx) => (
                      <span key={`${it.menuItemId}_${idx}`}>
                        {idx > 0 && <span className="text-slate-400"> · </span>}
                        <span className="font-mono-num font-semibold text-teal-800">
                          {it.quantity}×
                        </span>{' '}
                        {it.name}
                      </span>
                    ))}
                  </div>

                  {(order.customerAddress || order.note) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                      {order.customerAddress && (
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{order.customerAddress}</span>
                          <span className="text-slate-400 shrink-0">({order.deliveryZone})</span>
                        </span>
                      )}
                      {order.note && (
                        <span className="text-slate-500 italic">Ghi chú: {order.note}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Row 3: Total Payable + Payment Status Toggle + 1-Tap Progression & Utilities */}
                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <div>
                      <span className="font-mono-num text-base font-bold text-slate-900">
                        {formatVND(fin.customerPayable)}
                      </span>
                      {!isCancelled && (
                        <span className="ml-2 text-xs text-slate-500 font-mono-num">
                          (Lãi {formatVND(fin.grossProfit, false)}đ)
                        </span>
                      )}
                    </div>

                    {!isCancelled && (
                      <button
                        type="button"
                        onClick={() => handleTogglePaymentStatus(order)}
                        className={`text-xs font-semibold underline-offset-2 hover:underline ${
                          order.paymentStatus === 'unpaid'
                            ? order.paymentMethod === 'cod'
                              ? 'text-amber-700'
                              : 'text-red-600'
                            : 'text-emerald-700'
                        }`}
                        title="Nhấn 1 chạm để đổi Đã thu tiền / Chưa thu"
                      >
                        {order.paymentStatus === 'unpaid'
                          ? order.paymentMethod === 'cod'
                            ? 'Thu tiền mặt (COD)'
                            : 'Chưa chuyển khoản'
                          : order.paymentMethod === 'cod'
                            ? 'Đã thu tiền mặt'
                            : 'Đã chuyển khoản'}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          buildOrderConfirmationMessage(order),
                          `msg_${order.id}`
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                      title="Sao chép mẫu tin nhắn xác nhận gửi khách"
                    >
                      {copiedKey === `msg_${order.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Đã copy tin</span>
                        </>
                      ) : (
                        <>
                          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                          <span>Copy xác nhận</span>
                        </>
                      )}
                    </button>

                    {order.customerAddress && (
                      <a
                        href={getGoogleMapsUrl(order.customerAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                        title="Mở chỉ đường Google Maps"
                      >
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                        <span>Bản đồ</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedOrderId(order.id)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                    >
                      Chi tiết
                    </button>

                    {nextStep && (
                      <button
                        type="button"
                        onClick={() => handleAdvanceStatus(order)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${nextStep.buttonClass}`}
                      >
                        <span>{nextStep.label}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {filteredOrders.length > visibleLimit && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleLimit((v) => v + 40)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg"
              >
                Xem thêm đơn ({filteredOrders.length - visibleLimit} đơn còn lại)
              </button>
            </div>
          )}
        </section>
      ) : (
        /* Desktop Reconciliation Table View */
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">Mã đơn App / Ngày giao</th>
                  <th className="py-3 px-3 whitespace-nowrap">ĐVVC &amp; Mã vận đơn</th>
                  <th className="py-3 px-3 whitespace-nowrap">Khách hàng &amp; Nguồn</th>
                  <th className="py-3 px-3 whitespace-nowrap">Món đặt</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Khách trả</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Lãi gộp</th>
                  <th className="py-3 px-3 whitespace-nowrap">Thanh toán / Giao vận</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredOrders.slice(0, visibleLimit).map((order) => {
                  const fin = getOrderFinancials(order);
                  const fStatus = getEffectiveFulfillmentStatus(order);
                  const isCancelled = fStatus === 'cancelled';
                  const itemsPreview = order.items
                    .map((it) => `${it.quantity}× ${it.name}`)
                    .join(', ');
                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrderId(order.id)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono-num font-semibold text-slate-900">
                          {order.orderCode}
                        </div>
                        <div className="text-xs text-slate-500 font-mono-num">
                          {order.deliveryDate || order.date}
                          {order.deliverySlot ? ` · ${order.deliverySlot}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="text-xs font-medium text-slate-800">
                          {order.carrier || 'Tự giao'}
                        </div>
                        <div className="text-xs font-mono-num text-teal-700">
                          {order.carrierTrackingCode || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="text-xs font-medium text-slate-900">
                          {order.customerName || 'Khách lẻ'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {order.customerPhone ? `${order.customerPhone} · ` : ''}
                          {order.source}
                        </div>
                      </td>
                      <td className="py-3 px-3 max-w-xs">
                        <div className="text-xs text-slate-800 truncate" title={itemsPreview}>
                          {itemsPreview}
                        </div>
                        {order.customerAddress && (
                          <div
                            className="text-[11px] text-slate-400 truncate"
                            title={order.customerAddress}
                          >
                            {order.customerAddress}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                        {formatVND(fin.customerPayable, false)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                          isCancelled
                            ? 'text-slate-400'
                            : fin.grossProfit >= 0
                              ? 'text-emerald-700'
                              : 'text-red-600'
                        }`}
                      >
                        {formatVND(fin.grossProfit, false)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-xs">
                        <div
                          className={`font-medium ${
                            fStatus === 'completed'
                              ? 'text-emerald-700'
                              : fStatus === 'cancelled'
                                ? 'text-red-600'
                                : 'text-teal-700'
                          }`}
                        >
                          {FULFILLMENT_LABELS[fStatus]}
                        </div>
                        {!isCancelled && (
                          <div
                            className={
                              order.paymentStatus === 'unpaid'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }
                          >
                            {order.paymentStatus === 'unpaid' ? 'Chưa thu tiền' : 'Đã thanh toán'} (
                            {order.paymentMethod === 'cod' ? 'COD' : 'CK'})
                          </div>
                        )}
                      </td>
                      <td
                        className="py-3 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedOrderId(order.id)}
                          className="text-xs font-medium text-teal-700 hover:underline"
                        >
                          Mở chi tiết
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredOrders.length > visibleLimit && (
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Đang hiển thị {visibleLimit} / {filteredOrders.length} đơn
              </span>
              <button
                type="button"
                onClick={() => setVisibleLimit((v) => v + 50)}
                className="font-medium text-teal-700 hover:underline"
              >
                Tải thêm 50 đơn
              </button>
            </div>
          )}
        </section>
      )}

      {/* Mobile Floating Action Button (1-handed quick order entry) */}
      <button
        type="button"
        onClick={handleOpenCreateModal}
        className="sm:hidden fixed right-4 bottom-5 z-30 inline-flex items-center gap-2 px-4 py-3 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-full shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      >
        <Plus className="w-5 h-5" />
        <span>Tạo đơn nhanh</span>
      </button>

      {/* 4. Order Detail Slide-Over Drawer */}
      {selectedOrder && (() => {
        const fin = getOrderFinancials(selectedOrder);
        const fStatus = getEffectiveFulfillmentStatus(selectedOrder);
        const nextStep = NEXT_STEP_CONFIG[fStatus];
        const isCancelled = fStatus === 'cancelled';

        return (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div
              className="fixed inset-0 bg-slate-900/40"
              onClick={() => {
                setSelectedOrderId(null);
                setConfirmDeleteId(null);
              }}
            />
            <aside className="relative w-full max-w-lg bg-white h-full border-l border-slate-200 shadow-2xl z-10 flex flex-col">
              {/* Drawer Header */}
              <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-mono-num text-lg font-bold text-slate-900">
                      {selectedOrder.orderCode}
                    </h2>
                    <span className="text-slate-300">·</span>
                    <span
                      className={`text-xs font-semibold ${
                        fStatus === 'completed'
                          ? 'text-emerald-700'
                          : fStatus === 'cancelled'
                            ? 'text-red-600'
                            : 'text-teal-700'
                      }`}
                    >
                      {FULFILLMENT_LABELS[fStatus]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedOrder.source} · Giao {selectedOrder.deliveryDate || selectedOrder.date}
                    {selectedOrder.deliverySlot ? ` (${selectedOrder.deliverySlot})` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrderId(null);
                    setConfirmDeleteId(null);
                  }}
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
                  aria-label="Đóng chi tiết đơn"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
                {/* 1-Tap Quick Actions Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  {nextStep && (
                    <button
                      type="button"
                      onClick={() => handleAdvanceStatus(selectedOrder)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap ${nextStep.buttonClass}`}
                    >
                      <span>{nextStep.label}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => handleTogglePaymentStatus(selectedOrder)}
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                    >
                      {selectedOrder.paymentStatus === 'unpaid'
                        ? 'Đánh dấu Đã thu tiền'
                        : 'Chuyển về Chưa thu'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(selectedOrder)}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Sửa đơn</span>
                  </button>
                </div>

                {/* Shipping Carrier & Tracking Code Assignment */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-teal-700" />
                      <span>Gán đơn vị vận chuyển &amp; Mã vận đơn</span>
                    </span>
                    {copiedKey === 'saved_carrier' && (
                      <span className="text-xs font-medium text-emerald-700">Đã lưu mã ship</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Đơn vị vận chuyển
                      </label>
                      <select
                        value={drawerCarrier}
                        onChange={(e) => setDrawerCarrier(e.target.value as ShippingCarrier)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {SHIPPING_CARRIERS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">
                        Mã vận đơn ĐVVC (Xanh SM, Grab, Aha...)
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={drawerTrackingCode}
                        onChange={(e) => setDrawerTrackingCode(e.target.value)}
                        placeholder="Nhập mã vận đơn..."
                        className="w-full px-2.5 py-2 text-xs font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {drawerTrackingCode.trim() ? (
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(drawerTrackingCode.trim(), 'drawer_trk')
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
                      >
                        {copiedKey === 'drawer_trk' ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Đã sao chép mã vận đơn</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Sao chép mã vận đơn</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Mã app: <strong className="font-mono-num">{selectedOrder.orderCode}</strong>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveDrawerCarrier}
                      className="px-3 py-1.5 text-xs font-medium bg-teal-700 hover:bg-teal-800 text-white rounded-lg whitespace-nowrap"
                    >
                      Lưu mã ship
                    </button>
                  </div>
                </div>

                {/* Customer Info & Loyalty History */}
                <div className="space-y-3 border-b border-slate-200 pb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Khách hàng &amp; Địa chỉ giao
                    </span>
                    <span className="text-xs text-slate-500">
                      {selectedOrder.customerSegment === 'new' ? 'Khách mới' : 'Khách quay lại'}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="font-semibold text-sm text-slate-900">
                      {selectedOrder.customerName || 'Khách lẻ online'}
                    </div>
                    {selectedOrder.customerPhone && (
                      <div className="flex items-center gap-3">
                        <a
                          href={`tel:${selectedOrder.customerPhone}`}
                          className="inline-flex items-center gap-1 font-mono-num text-teal-700 font-medium hover:underline"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>{selectedOrder.customerPhone}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            void copyToClipboard(selectedOrder.customerPhone!, 'drawer_phone')
                          }
                          className="text-slate-500 hover:text-slate-800"
                        >
                          {copiedKey === 'drawer_phone' ? 'Đã copy' : 'Copy SĐT'}
                        </button>
                      </div>
                    )}
                    {selectedOrder.customerAddress && (
                      <div className="flex items-start justify-between gap-2 pt-1">
                        <span className="text-slate-600 leading-relaxed">
                          {selectedOrder.customerAddress} ({selectedOrder.deliveryZone})
                        </span>
                        <a
                          href={getGoogleMapsUrl(selectedOrder.customerAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-md shrink-0 whitespace-nowrap"
                        >
                          <span>Mở bản đồ</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  {customerHistory && (
                    <div className="pt-2.5 mt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-slate-500">Số lần mua</div>
                        <div className="font-mono-num font-bold text-slate-900 mt-0.5">
                          {customerHistory.orderCount} đơn
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Tổng chi tiêu</div>
                        <div className="font-mono-num font-bold text-teal-700 mt-0.5">
                          {formatVND(customerHistory.totalSpend, false)} đ
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-slate-500">Món hay đặt</div>
                        <div
                          className="font-medium text-slate-800 truncate mt-0.5"
                          title={customerHistory.favoriteDish}
                        >
                          {customerHistory.favoriteDish}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Itemized Breakdown & Real Profit */}
                <div className="space-y-2.5 border-b border-slate-200 pb-4">
                  <div className="text-xs font-semibold text-slate-800">
                    Chi tiết món &amp; Lợi nhuận thực tế
                  </div>
                  <div className="divide-y divide-slate-100">
                    {selectedOrder.items.map((it, idx) => (
                      <div
                        key={`${it.menuItemId}_${idx}`}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">
                            <span className="font-mono-num text-teal-700 font-semibold">
                              {it.quantity}×
                            </span>{' '}
                            {it.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono-num">
                            Giá bán {formatVND(it.unitPrice, false)}đ · Vốn{' '}
                            {formatVND(it.unitCogs, false)}đ
                          </div>
                        </div>
                        <div className="font-mono-num font-semibold text-slate-900 shrink-0">
                          {formatVND(it.unitPrice * it.quantity, false)} đ
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Tạm tính tiền món</span>
                      <span className="font-mono-num">{formatVND(fin.gross)}</span>
                    </div>
                    {fin.discount > 0 && (
                      <div className="flex justify-between">
                        <span>Giảm giá / Ưu đãi</span>
                        <span className="font-mono-num text-red-600">
                          -{formatVND(fin.discount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Phí ship thu khách</span>
                      <span className="font-mono-num">
                        {fin.shipCollected === 0 ? 'Miễn phí' : formatVND(fin.shipCollected)}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold text-sm text-slate-900 pt-1.5 border-t border-slate-100">
                      <span>Tổng khách thanh toán</span>
                      <span className="font-mono-num text-teal-800">
                        {formatVND(fin.customerPayable)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-500 pt-1">
                      <span>
                        Giá vốn ({formatVND(fin.cogs, false)}đ) + Bù ship (
                        {formatVND(fin.shippingSubsidy, false)}đ)
                      </span>
                      <span className="font-mono-num">
                        -{formatVND(fin.cogs + fin.shippingSubsidy, false)} đ
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-700">Lãi gộp thực tế cầm về</span>
                      <span
                        className={`font-mono-num ${
                          fin.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatVND(fin.grossProfit)}
                      </span>
                    </div>
                  </div>

                  {selectedOrder.note && (
                    <div className="pt-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Ghi chú: </span>
                      {selectedOrder.note}
                    </div>
                  )}
                </div>

                {/* Solo-Operator Utilities: Copy Message, PNG Receipt, Duplicate Order */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-800">Tiện ích gửi khách &amp; lên đơn</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          buildOrderConfirmationMessage(selectedOrder),
                          'drawer_msg'
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                    >
                      {copiedKey === 'drawer_msg' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Đã copy tin</span>
                        </>
                      ) : (
                        <>
                          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                          <span>Copy xác nhận</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadOrderReceiptImage(selectedOrder)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                      <span>Xuất ảnh hóa đơn</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenDuplicateModal(selectedOrder)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Đặt lại như cũ</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Drawer Footer: Cancel / Restore / Delete */}
              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSalesOrder(selectedOrder.id, {
                      status: isCancelled ? 'completed' : 'cancelled',
                      fulfillmentStatus: isCancelled ? 'confirmed' : 'cancelled',
                    })
                  }
                  className={`text-xs font-medium hover:underline ${
                    isCancelled ? 'text-teal-700' : 'text-amber-700'
                  }`}
                >
                  {isCancelled ? 'Khôi phục đơn này' : 'Đánh dấu Hủy / Hoàn đơn'}
                </button>

                {confirmDeleteId === selectedOrder.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteSalesOrder(selectedOrder.id);
                        setSelectedOrderId(null);
                        setConfirmDeleteId(null);
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-md"
                    >
                      Xác nhận xóa
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-600 rounded-md"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedOrder.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa đơn</span>
                  </button>
                )}
              </div>
            </aside>
          </div>
        );
      })()}

      {/* Quick Create / Edit / Duplicate Modal */}
      <SalesOrderModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingOrder(null);
          setDuplicateOrder(null);
        }}
        menuItems={menuItems}
        catalogMap={catalogMap}
        existingOrders={salesOrders}
        editingOrder={editingOrder}
        duplicateFromOrder={duplicateOrder}
        onCreateOrder={onAddSalesOrder}
        onUpdateOrder={onUpdateSalesOrder}
      />
    </div>
  );
}
