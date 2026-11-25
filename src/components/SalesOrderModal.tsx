import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, RefreshCw, Search, Trash2, UserCheck, X } from 'lucide-react';
import {
  DELIVERY_SLOTS,
  DELIVERY_ZONES,
  ORDER_SOURCES,
  SHIPPING_CARRIERS,
} from '../data/initialSalesData';
import {
  CatalogItem,
  CustomerSegment,
  DeliveryZone,
  FulfillmentStatus,
  MenuItem,
  OrderSource,
  PaymentMethod,
  PaymentStatus,
  SalesOrder,
  SalesOrderItem,
  ShippingCarrier,
} from '../types/costing';
import {
  computeMenuItemCosting,
  formatPercent,
  formatVND,
  normalizeVietnamese,
} from '../utils/formatters';
import {
  addDaysISO,
  formatISODate,
  getEffectiveFulfillmentStatus,
} from '../utils/salesAnalytics';

interface SalesOrderModalProps {
  open: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  existingOrders?: SalesOrder[];
  editingOrder?: SalesOrder | null;
  duplicateFromOrder?: SalesOrder | null;
  onCreateOrder: (order: Omit<SalesOrder, 'id'>) => void;
  onUpdateOrder?: (id: string, patch: Partial<SalesOrder>) => void;
}

interface DraftLine {
  key: string;
  menuItemId: string;
  quantity: number;
}

interface KnownCustomer {
  key: string;
  name: string;
  phone: string;
  address: string;
  zone: DeliveryZone;
  source: OrderSource;
  orderCount: number;
}

const ZONE_SHIPPING_DEFAULTS: Record<DeliveryZone, { collected: number; actual: number }> = {
  'Nội thành (<3km)': { collected: 15000, actual: 16000 },
  'Trung tâm (3–7km)': { collected: 20000, actual: 25000 },
  'Ngoại thành (>7km)': { collected: 28000, actual: 36000 },
};

function generateAppOrderCode(dateISO: string): string {
  const shortDate = dateISO.replace(/-/g, '').slice(2);
  const rand = String(Math.floor(100 + Math.random() * 900));
  return `DH${shortDate}-${rand}`;
}

export function SalesOrderModal({
  open,
  onClose,
  menuItems,
  catalogMap,
  existingOrders = [],
  editingOrder = null,
  duplicateFromOrder = null,
  onCreateOrder,
  onUpdateOrder,
}: SalesOrderModalProps) {
  const defaultMenuId = menuItems[0]?.id ?? '';
  const todayISO = formatISODate(new Date());
  const tomorrowISO = addDaysISO(todayISO, 1);

  const [date, setDate] = useState(todayISO);
  const [deliveryDate, setDeliveryDate] = useState(todayISO);
  const [deliverySlot, setDeliverySlot] = useState('Giao ngay');
  const [orderCode, setOrderCode] = useState(() => generateAppOrderCode(todayISO));
  const [carrier, setCarrier] = useState<ShippingCarrier>('Tự giao');
  const [carrierTrackingCode, setCarrierTrackingCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [source, setSource] = useState<OrderSource>('Zalo / Tin nhắn');
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone>('Nội thành (<3km)');
  const [customerSegment, setCustomerSegment] = useState<CustomerSegment>('returning');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [fulfillmentStatus, setFulfillmentStatus] = useState<FulfillmentStatus>('pending');

  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [shippingFeeCollected, setShippingFeeCollected] = useState<number>(15000);
  const [shippingCostActual, setShippingCostActual] = useState<number>(16000);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 'l_1', menuItemId: defaultMenuId, quantity: 1 },
  ]);

  // Hydrate form whenever modal opens or mode changes
  useEffect(() => {
    if (!open) return;

    if (editingOrder) {
      setDate(editingOrder.date);
      setDeliveryDate(editingOrder.deliveryDate || editingOrder.date);
      setDeliverySlot(editingOrder.deliverySlot || 'Giao ngay');
      setOrderCode(editingOrder.orderCode);
      setCarrier(editingOrder.carrier || 'Tự giao');
      setCarrierTrackingCode(editingOrder.carrierTrackingCode || '');
      setCustomerName(editingOrder.customerName || '');
      setCustomerPhone(editingOrder.customerPhone || '');
      setCustomerAddress(editingOrder.customerAddress || '');
      setSource(editingOrder.source);
      setDeliveryZone(editingOrder.deliveryZone);
      setCustomerSegment(editingOrder.customerSegment);
      setPaymentMethod(editingOrder.paymentMethod || 'transfer');
      setPaymentStatus(editingOrder.paymentStatus || 'paid');
      setFulfillmentStatus(getEffectiveFulfillmentStatus(editingOrder));
      setDiscountAmount(editingOrder.discountAmount || 0);
      setShippingFeeCollected(editingOrder.shippingFeeCollected || 0);
      setShippingCostActual(editingOrder.shippingCostActual || 0);
      setNote(editingOrder.note || '');
      setLines(
        editingOrder.items.length > 0
          ? editingOrder.items.map((it, idx) => ({
              key: `edit_${idx}_${it.menuItemId}`,
              menuItemId: menuItems.some((m) => m.id === it.menuItemId)
                ? it.menuItemId
                : defaultMenuId,
              quantity: it.quantity,
            }))
          : [{ key: 'l_1', menuItemId: defaultMenuId, quantity: 1 }]
      );
      setCustomerQuery('');
      setShowCustomerDropdown(false);
      return;
    }

    if (duplicateFromOrder) {
      setDate(todayISO);
      setDeliveryDate(todayISO);
      setDeliverySlot(duplicateFromOrder.deliverySlot || 'Giao ngay');
      setOrderCode(generateAppOrderCode(todayISO));
      setCarrier(duplicateFromOrder.carrier || 'Tự giao');
      setCarrierTrackingCode('');
      setCustomerName(duplicateFromOrder.customerName || '');
      setCustomerPhone(duplicateFromOrder.customerPhone || '');
      setCustomerAddress(duplicateFromOrder.customerAddress || '');
      setSource(duplicateFromOrder.source);
      setDeliveryZone(duplicateFromOrder.deliveryZone);
      setCustomerSegment('returning');
      setPaymentMethod(duplicateFromOrder.paymentMethod || 'transfer');
      setPaymentStatus('unpaid');
      setFulfillmentStatus('confirmed');
      setDiscountAmount(duplicateFromOrder.discountAmount || 0);
      setShippingFeeCollected(duplicateFromOrder.shippingFeeCollected || 0);
      setShippingCostActual(duplicateFromOrder.shippingCostActual || 0);
      setNote(duplicateFromOrder.note || '');
      setLines(
        duplicateFromOrder.items.length > 0
          ? duplicateFromOrder.items.map((it, idx) => ({
              key: `dup_${idx}_${it.menuItemId}`,
              menuItemId: menuItems.some((m) => m.id === it.menuItemId)
                ? it.menuItemId
                : defaultMenuId,
              quantity: it.quantity,
            }))
          : [{ key: 'l_1', menuItemId: defaultMenuId, quantity: 1 }]
      );
      setCustomerQuery('');
      setShowCustomerDropdown(false);
      return;
    }

    // Fresh quick order
    setDate(todayISO);
    setDeliveryDate(todayISO);
    setDeliverySlot('Giao ngay');
    setOrderCode(generateAppOrderCode(todayISO));
    setCarrier('Tự giao');
    setCarrierTrackingCode('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setSource('Zalo / Tin nhắn');
    setDeliveryZone('Nội thành (<3km)');
    setCustomerSegment('new');
    setPaymentMethod('transfer');
    setPaymentStatus('unpaid');
    setFulfillmentStatus('pending');
    setDiscountAmount(0);
    setShippingFeeCollected(15000);
    setShippingCostActual(16000);
    setNote('');
    setLines([{ key: `l_${Date.now()}`, menuItemId: defaultMenuId, quantity: 1 }]);
    setCustomerQuery('');
    setShowCustomerDropdown(false);
  }, [open, editingOrder, duplicateFromOrder, todayISO, defaultMenuId, menuItems]);

  const menuMap = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

  // Build returning-customer directory from previous orders for 1-tap autofill
  const knownCustomers = useMemo(() => {
    const byKey = new Map<string, KnownCustomer>();
    for (const o of existingOrders) {
      const phone = (o.customerPhone || '').trim();
      const name = (o.customerName || '').trim();
      if (!phone && !name) continue;
      const key = phone || name.toLowerCase();
      const prev = byKey.get(key);
      if (prev) {
        prev.orderCount += 1;
        if (!prev.address && o.customerAddress) prev.address = o.customerAddress;
      } else {
        byKey.set(key, {
          key,
          name: name || 'Khách quen',
          phone,
          address: o.customerAddress || '',
          zone: o.deliveryZone,
          source: o.source,
          orderCount: 1,
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.orderCount - a.orderCount);
  }, [existingOrders]);

  const filteredCustomers = useMemo(() => {
    const q = normalizeVietnamese(customerQuery.trim());
    if (!q) return knownCustomers.slice(0, 6);
    return knownCustomers
      .filter(
        (c) =>
          normalizeVietnamese(c.name).includes(q) ||
          c.phone.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
          normalizeVietnamese(c.address).includes(q)
      )
      .slice(0, 6);
  }, [knownCustomers, customerQuery]);

  const resolvedItems: SalesOrderItem[] = useMemo(() => {
    const out: SalesOrderItem[] = [];
    for (const line of lines) {
      const m = menuMap.get(line.menuItemId);
      if (!m || line.quantity <= 0) continue;
      const cogs = Math.round(computeMenuItemCosting(m, catalogMap, 0).cogsPerUnit);
      out.push({
        menuItemId: m.id,
        code: m.code,
        name: m.name,
        category: m.category,
        quantity: Math.max(1, Math.round(line.quantity)),
        unitPrice: m.sellingPrice,
        unitCogs: cogs,
      });
    }
    return out;
  }, [lines, menuMap, catalogMap]);

  const preview = useMemo(() => {
    const isCancelled = fulfillmentStatus === 'cancelled';
    const gross = resolvedItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const cogs = resolvedItems.reduce((s, it) => s + it.unitCogs * it.quantity, 0);
    const net = isCancelled ? 0 : Math.max(0, gross - discountAmount);
    const shippingSubsidy = isCancelled
      ? 0
      : Math.max(0, shippingCostActual - shippingFeeCollected);
    const customerPayable = isCancelled ? 0 : net + shippingFeeCollected;
    const grossProfit = isCancelled ? 0 : net - cogs - shippingSubsidy;
    const marginPct = net > 0 ? (grossProfit / net) * 100 : 0;
    return { gross, cogs, net, shippingSubsidy, customerPayable, grossProfit, marginPct };
  }, [resolvedItems, discountAmount, shippingFeeCollected, shippingCostActual, fulfillmentStatus]);

  if (!open) return null;

  const handleZoneChange = (nextZone: DeliveryZone) => {
    setDeliveryZone(nextZone);
    const defaults = ZONE_SHIPPING_DEFAULTS[nextZone];
    setShippingFeeCollected(defaults.collected);
    setShippingCostActual(defaults.actual);
  };

  const handleSelectCustomer = (c: KnownCustomer) => {
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    setCustomerAddress(c.address);
    setSource(c.source);
    handleZoneChange(c.zone);
    setCustomerSegment('returning');
    setCustomerQuery('');
    setShowCustomerDropdown(false);
  };

  const handleAddLine = () => {
    const unused = menuItems.find((m) => !lines.some((l) => l.menuItemId === m.id));
    setLines((prev) => [
      ...prev,
      {
        key: `l_${Date.now()}_${prev.length}`,
        menuItemId: unused?.id ?? defaultMenuId,
        quantity: 1,
      },
    ]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resolvedItems.length === 0) return;

    const isCancelled = fulfillmentStatus === 'cancelled';
    const payload: Omit<SalesOrder, 'id'> = {
      orderCode: orderCode.trim() || generateAppOrderCode(date),
      date,
      deliveryDate: deliveryDate || date,
      deliverySlot: deliverySlot.trim() || 'Giao ngay',
      source,
      deliveryZone,
      customerSegment,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerAddress: customerAddress.trim(),
      carrier,
      carrierTrackingCode: carrierTrackingCode.trim(),
      paymentMethod,
      paymentStatus: isCancelled ? 'unpaid' : paymentStatus,
      fulfillmentStatus,
      status: isCancelled ? 'cancelled' : 'completed',
      items: resolvedItems,
      discountAmount: isCancelled ? 0 : Math.max(0, discountAmount),
      shippingFeeCollected: isCancelled ? 0 : Math.max(0, shippingFeeCollected),
      shippingCostActual: isCancelled ? 0 : Math.max(0, shippingCostActual),
      note: note.trim(),
    };

    if (editingOrder && onUpdateOrder) {
      onUpdateOrder(editingOrder.id, payload);
    } else {
      onCreateOrder(payload);
    }
    onClose();
  };

  const modalTitle = editingOrder
    ? `Cập nhật đơn ${editingOrder.orderCode}`
    : duplicateFromOrder
      ? 'Nhân bản đơn nhanh (Lấy như lần trước)'
      : 'Tạo đơn bán hàng online nhanh';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl max-h-[94vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              {modalTitle}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Gán mã đơn ứng dụng &amp; mã vận đơn (Xanh SM, Grab, Ahamove...) · Giá vốn tự động đồng bộ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Section 1: Returning customer 1-tap lookup + Customer details */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">Thông tin khách hàng</span>
              {knownCustomers.length > 0 && !editingOrder && (
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={customerQuery}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 180)}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    placeholder="Chọn nhanh khách cũ (tên / SĐT)..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
                  />
                  {showCustomerDropdown && filteredCustomers.length > 0 && (
                    <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 divide-y divide-slate-100 max-h-52 overflow-y-auto">
                      {filteredCustomers.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onMouseDown={() => handleSelectCustomer(c)}
                          className="w-full px-3 py-2 text-left hover:bg-teal-50/70 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-slate-900 truncate flex items-center gap-1.5">
                              <UserCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                              <span className="truncate">{c.name}</span>
                            </span>
                            <span className="font-mono-num text-slate-500 shrink-0">
                              {c.orderCount} đơn
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {c.phone ? `${c.phone} · ` : ''}
                            {c.address || c.zone}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tên khách hàng</label>
                <input
                  type="text"
                  maxLength={120}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="VD: Chị Thảo Vy"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  maxLength={30}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="090x xxx xxx"
                  className="w-full px-3 py-2 text-sm font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Địa chỉ giao hàng</label>
              <input
                type="text"
                maxLength={300}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Số nhà, tên đường, phường/quận (dùng để mở nhanh Google Maps khi đi giao)"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {/* Section 2: Dual Order Codes (App Code + Carrier & Carrier Tracking Code) */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <span className="text-xs font-semibold text-slate-800 block">
              Mã đơn ứng dụng &amp; Mã đơn vị vận chuyển
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Mã đơn ứng dụng
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={orderCode}
                    onChange={(e) => setOrderCode(e.target.value)}
                    className="w-full min-w-0 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  {!editingOrder && (
                    <button
                      type="button"
                      onClick={() => setOrderCode(generateAppOrderCode(deliveryDate || date))}
                      className="p-2 text-slate-500 hover:text-teal-700 border border-slate-200 rounded-lg shrink-0"
                      title="Tạo mã mới"
                      aria-label="Tạo mã mới"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Đơn vị vận chuyển
                </label>
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value as ShippingCarrier)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  {SHIPPING_CARRIERS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Mã vận đơn ĐVVC
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={carrierTrackingCode}
                  onChange={(e) => setCarrierTrackingCode(e.target.value)}
                  placeholder={carrier === 'Tự giao' ? 'Không bắt buộc' : 'VD: XSM-89421, GRB-...'}
                  className="w-full px-3 py-2 text-sm font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Schedule, Source, Zone */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">Ngày hẹn giao</label>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDeliveryDate(todayISO)}
                    className={`hover:underline ${
                      deliveryDate === todayISO ? 'text-teal-700 font-semibold' : 'text-slate-500'
                    }`}
                  >
                    Hôm nay
                  </button>
                  <span className="text-slate-300">/</span>
                  <button
                    type="button"
                    onClick={() => setDeliveryDate(tomorrowISO)}
                    className={`hover:underline ${
                      deliveryDate === tomorrowISO
                        ? 'text-teal-700 font-semibold'
                        : 'text-slate-500'
                    }`}
                  >
                    Ngày mai
                  </button>
                </div>
              </div>
              <input
                type="date"
                required
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Khung giờ giao</label>
              <select
                value={DELIVERY_SLOTS.includes(deliverySlot) ? deliverySlot : 'Giao ngay'}
                onChange={(e) => setDeliverySlot(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {DELIVERY_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nguồn chốt đơn</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as OrderSource)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {ORDER_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Khu vực ship</label>
              <select
                value={deliveryZone}
                onChange={(e) => handleZoneChange(e.target.value as DeliveryZone)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {DELIVERY_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 4: Order Items with 1-hand friendly +/- steppers */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">Danh sách món trong đơn</label>
              <button
                type="button"
                onClick={handleAddLine}
                disabled={menuItems.length === 0}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm món</span>
              </button>
            </div>

            {menuItems.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                Chưa có món nào trong thực đơn. Vui lòng tạo món ở tab Định lượng &amp; Tính giá trước.
              </div>
            ) : (
              <div className="space-y-2">
                {lines.map((line) => {
                  const dish = menuMap.get(line.menuItemId);
                  const lineTotal = (dish?.sellingPrice || 0) * line.quantity;
                  return (
                    <div key={line.key} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <select
                        value={line.menuItemId}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key ? { ...l, menuItemId: e.target.value } : l
                            )
                          )
                        }
                        className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {menuItems.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.name} ({formatVND(m.sellingPrice)})
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center border border-slate-200 rounded-lg bg-white shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l.key === line.key
                                  ? { ...l, quantity: Math.max(1, l.quantity - 1) }
                                  : l
                              )
                            )
                          }
                          className="p-2 text-slate-500 hover:text-slate-900"
                          aria-label="Giảm số lượng"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l.key === line.key
                                  ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) }
                                  : l
                              )
                            )
                          }
                          className="w-12 py-1.5 text-sm text-center font-mono-num focus:outline-none"
                          aria-label="Số lượng"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l.key === line.key
                                  ? { ...l, quantity: Math.min(999, l.quantity + 1) }
                                  : l
                              )
                            )
                          }
                          className="p-2 text-slate-500 hover:text-slate-900"
                          aria-label="Tăng số lượng"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="w-24 text-right font-mono-num text-sm font-medium text-slate-800 shrink-0 ml-auto sm:ml-0">
                        {formatVND(lineTotal, false)} đ
                      </div>
                      <button
                        type="button"
                        disabled={lines.length <= 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        className="p-2 text-slate-400 hover:text-red-600 disabled:opacity-30 rounded-lg shrink-0"
                        aria-label="Xóa dòng món"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 5: Payment, Fulfillment Status, Customer Segment & Shipping Economics */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Thanh toán
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('transfer')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    paymentMethod === 'transfer'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chuyển khoản
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cod')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    paymentMethod === 'cod'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Thu COD
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Tình trạng thu tiền
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPaymentStatus('paid')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    paymentStatus === 'paid'
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Đã thu tiền
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatus('unpaid')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    paymentStatus === 'unpaid'
                      ? 'bg-white text-amber-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chưa thu
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Trạng thái giao vận
              </label>
              <select
                value={fulfillmentStatus}
                onChange={(e) => setFulfillmentStatus(e.target.value as FulfillmentStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="pending">Chờ xác nhận</option>
                <option value="confirmed">Đã xác nhận</option>
                <option value="delivering">Đang giao hàng</option>
                <option value="completed">Hoàn tất</option>
                <option value="cancelled">Đã hủy / Hoàn đơn</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Giảm giá (đ)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm text-right font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Ship thu khách (đ)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={shippingFeeCollected}
                onChange={(e) => setShippingFeeCollected(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm text-right font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Trả shipper (đ)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={shippingCostActual}
                onChange={(e) => setShippingCostActual(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm text-right font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phân loại khách</label>
              <select
                value={customerSegment}
                onChange={(e) => setCustomerSegment(e.target.value as CustomerSegment)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="new">Khách mới</option>
                <option value="returning">Khách quay lại</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú giao hàng / dặn dò</label>
              <input
                type="text"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Ít cay, gọi trước 10 phút, gửi bảo vệ sảnh A..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ngày ghi nhận doanh thu</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {/* Real-time financial summary strip */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Tổng khách trả</div>
              <div className="mt-0.5 font-mono-num text-sm font-bold text-teal-800">
                {formatVND(preview.customerPayable)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Doanh thu món (Net)</div>
              <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-900">
                {formatVND(preview.net)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Giá vốn + Bù ship</div>
              <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-700">
                {formatVND(preview.cogs + preview.shippingSubsidy)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Lãi gộp thực tế</div>
              <div
                className={`mt-0.5 font-mono-num text-sm font-semibold ${
                  preview.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {formatVND(preview.grossProfit)} ({formatPercent(preview.marginPct)})
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={resolvedItems.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              {editingOrder ? 'Lưu thay đổi' : 'Lưu đơn bán hàng'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
