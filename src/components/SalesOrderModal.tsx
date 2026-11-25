import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { DELIVERY_ZONES, ORDER_SOURCES } from '../data/initialSalesData';
import {
  CatalogItem,
  CustomerSegment,
  DeliveryZone,
  MenuItem,
  OrderSource,
  OrderStatus,
  SalesOrder,
  SalesOrderItem,
} from '../types/costing';
import { computeMenuItemCosting, formatPercent, formatVND } from '../utils/formatters';
import { formatISODate } from '../utils/salesAnalytics';

interface SalesOrderModalProps {
  open: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  onCreateOrder: (order: Omit<SalesOrder, 'id'>) => void;
}

interface DraftLine {
  key: string;
  menuItemId: string;
  quantity: number;
}

const ZONE_SHIPPING_DEFAULTS: Record<DeliveryZone, { collected: number; actual: number }> = {
  'Nội thành (<3km)': { collected: 15000, actual: 16000 },
  'Trung tâm (3–7km)': { collected: 20000, actual: 25000 },
  'Ngoại thành (>7km)': { collected: 28000, actual: 36000 },
};

export function SalesOrderModal({
  open,
  onClose,
  menuItems,
  catalogMap,
  onCreateOrder,
}: SalesOrderModalProps) {
  const defaultMenuId = menuItems[0]?.id ?? '';
  const todayISO = formatISODate(new Date());

  const [date, setDate] = useState(todayISO);
  const [orderCode, setOrderCode] = useState(
    () => `DH${todayISO.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`
  );
  const [source, setSource] = useState<OrderSource>('Zalo / Tin nhắn');
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone>('Nội thành (<3km)');
  const [customerSegment, setCustomerSegment] = useState<CustomerSegment>('returning');
  const [status, setStatus] = useState<OrderStatus>('completed');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [shippingFeeCollected, setShippingFeeCollected] = useState<number>(15000);
  const [shippingCostActual, setShippingCostActual] = useState<number>(16000);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 'l_1', menuItemId: defaultMenuId, quantity: 1 },
  ]);

  const menuMap = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), [menuItems]);

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
    const gross = resolvedItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const cogs = resolvedItems.reduce((s, it) => s + it.unitCogs * it.quantity, 0);
    const net = status === 'cancelled' ? 0 : Math.max(0, gross - discountAmount);
    const shippingSubsidy =
      status === 'cancelled' ? 0 : Math.max(0, shippingCostActual - shippingFeeCollected);
    const grossProfit = status === 'cancelled' ? 0 : net - cogs - shippingSubsidy;
    const marginPct = net > 0 ? (grossProfit / net) * 100 : 0;
    return { gross, cogs, net, shippingSubsidy, grossProfit, marginPct };
  }, [resolvedItems, discountAmount, shippingFeeCollected, shippingCostActual, status]);

  if (!open) return null;

  const handleZoneChange = (nextZone: DeliveryZone) => {
    setDeliveryZone(nextZone);
    const defaults = ZONE_SHIPPING_DEFAULTS[nextZone];
    setShippingFeeCollected(defaults.collected);
    setShippingCostActual(defaults.actual);
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

    onCreateOrder({
      orderCode: orderCode.trim() || `DH-${Date.now().toString().slice(-5)}`,
      date,
      source,
      deliveryZone,
      customerSegment,
      status,
      items: resolvedItems,
      discountAmount: status === 'cancelled' ? 0 : Math.max(0, discountAmount),
      shippingFeeCollected: status === 'cancelled' ? 0 : Math.max(0, shippingFeeCollected),
      shippingCostActual: status === 'cancelled' ? 0 : Math.max(0, shippingCostActual),
      note: note.trim(),
    });

    // Reset for next quick entry
    const nextCode = `DH${todayISO.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`;
    setOrderCode(nextCode);
    setDiscountAmount(0);
    setNote('');
    setLines([{ key: `l_${Date.now()}`, menuItemId: defaultMenuId, quantity: 1 }]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Ghi nhận đơn bán hàng online
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kênh bán trực tiếp tự phân phối ship · Giá vốn tự động đồng bộ từ bảng định lượng
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Row 1: Order metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ngày bán</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mã đơn hàng</label>
              <input
                type="text"
                required
                maxLength={40}
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg font-mono-num focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Trạng thái đơn</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="completed">Hoàn tất giao hàng</option>
                <option value="cancelled">Đã hủy / Hoàn đơn</option>
              </select>
            </div>
          </div>

          {/* Row 2: Direct online channel attributes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nguồn đơn online</label>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Khu vực giao ship</label>
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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phân loại khách</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCustomerSegment('new')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    customerSegment === 'new'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khách mới
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerSegment('returning')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    customerSegment === 'returning'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Quay lại
                </button>
              </div>
            </div>
          </div>

          {/* Row 3: Order Items */}
          <div className="space-y-2.5">
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
                    <div key={line.key} className="flex items-center gap-2">
                      <select
                        value={line.menuItemId}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key ? { ...l, menuItemId: e.target.value } : l
                            )
                          )
                        }
                        className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {menuItems.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.name} ({formatVND(m.sellingPrice)})
                          </option>
                        ))}
                      </select>
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
                        className="w-20 px-2.5 py-2 text-sm text-right font-mono-num bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        aria-label="Số lượng"
                      />
                      <div className="w-28 text-right font-mono-num text-sm font-medium text-slate-800 shrink-0">
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

          {/* Row 4: Discount & Self-delivery shipping economics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Giảm giá / Voucher (đ)
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
                Phí ship thu khách (đ)
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
                Phí trả shipper thực tế (đ)
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
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú đơn hàng</label>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: Freeship đơn nhóm văn phòng, khách hẹn giao 14h..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          {/* Real-time financial summary strip */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500">Thực thu (Net)</div>
              <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-900">
                {formatVND(preview.net)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Giá vốn món</div>
              <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-700">
                {formatVND(preview.cogs)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Quán bù ship</div>
              <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-700">
                {formatVND(preview.shippingSubsidy)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Lãi gộp đơn</div>
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
              Lưu đơn bán hàng
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
