import {
  CatalogItem,
  CustomerSegment,
  DeliveryZone,
  FulfillmentStatus,
  MenuItem,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SalesOrder,
  SalesOrderItem,
  SalesTargetConfig,
  ShippingCarrier,
} from '../types/costing';
import { computeMenuItemCosting } from '../utils/formatters';

export const INITIAL_SALES_TARGET: SalesTargetConfig = {
  period: 'month',
  mode: 'profit',
  targetMonthlyProfit: 20000000, // 20 triệu lãi ròng / tháng
  targetMonthlyUnits: 1600,
  estimatedAppCommissionPct: 25,
};

export const ORDER_SOURCES: OrderSource[] = [
  'Zalo / Tin nhắn',
  'Facebook / Messenger',
  'Threads',
  'Website đặt trực tiếp',
  'Khách quen / Hotline',
];

export const DELIVERY_ZONES: DeliveryZone[] = [
  'Nội thành (<3km)',
  'Trung tâm (3–7km)',
  'Ngoại thành (>7km)',
];

export const SHIPPING_CARRIERS: ShippingCarrier[] = [
  'Tự giao',
  'Xanh SM',
  'Grab Express',
  'Ahamove',
  'Be Delivery',
  'Lalamove',
  'GHTK / GHN',
  'Khác',
];

export const DELIVERY_SLOTS: string[] = [
  'Giao ngay',
  'Sáng (8h–11h)',
  'Chiều (13h–17h)',
  'Tối (17h–20h)',
];

const SAMPLE_CUSTOMERS: Array<{
  name: string;
  phone: string;
  address: string;
  zone: DeliveryZone;
}> = [
  { name: 'Chị Thảo Vy', phone: '0908412773', address: '42 Nguyễn Đình Chiểu, Q.1', zone: 'Nội thành (<3km)' },
  { name: 'Anh Minh Quân', phone: '0917228541', address: '118 Võ Văn Tần, Q.3', zone: 'Nội thành (<3km)' },
  { name: 'Lan Anh (VP Etown)', phone: '0938665102', address: '364 Cộng Hòa, Tân Bình', zone: 'Trung tâm (3–7km)' },
  { name: 'Ngọc Hân', phone: '0989310445', address: '275 Điện Biên Phủ, Bình Thạnh', zone: 'Nội thành (<3km)' },
  { name: 'Anh Hoàng Nam', phone: '0903771829', address: '89 Nguyễn Hữu Cảnh, Bình Thạnh', zone: 'Trung tâm (3–7km)' },
  { name: 'Chị Bảo Trâm', phone: '0976540912', address: '15 Phan Xích Long, Phú Nhuận', zone: 'Nội thành (<3km)' },
  { name: 'Minh Thư', phone: '0934129880', address: '210 Lê Văn Sỹ, Q.3', zone: 'Nội thành (<3km)' },
  { name: 'Quốc Khánh', phone: '0909883421', address: '54 Thảo Điền, TP. Thủ Đức', zone: 'Ngoại thành (>7km)' },
  { name: 'Chị Kim Ngân', phone: '0918456209', address: '102 Nguyễn Thị Minh Khai, Q.1', zone: 'Nội thành (<3km)' },
  { name: 'Thanh Trúc', phone: '0962774318', address: '420 Nguyễn Văn Linh, Q.7', zone: 'Ngoại thành (>7km)' },
  { name: 'Hải Yến', phone: '0932519084', address: '68 Hoàng Hoa Thám, Bình Thạnh', zone: 'Trung tâm (3–7km)' },
  { name: 'Anh Đức Huy', phone: '0907612398', address: '192 Cao Thắng, Q.10', zone: 'Trung tâm (3–7km)' },
];

function formatISODateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function seededRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function makeCarrierTracking(carrier: ShippingCarrier, seq: number, rng: () => number): string {
  const num = String(10000 + Math.floor(rng() * 89999));
  switch (carrier) {
    case 'Xanh SM':
      return `XSM-${seq}${num.slice(0, 3)}`;
    case 'Grab Express':
      return `GRB-${num}`;
    case 'Ahamove':
      return `AHA-${seq}${num.slice(1, 4)}`;
    case 'Be Delivery':
      return `BE-${num}`;
    case 'Lalamove':
      return `LLM-${num}`;
    case 'GHTK / GHN':
      return `GHN-${num}`;
    default:
      return '';
  }
}

/**
 * Generates a realistic, deterministic 60-day history of direct-online self-delivered orders
 * grounded in the current menu items & real recipe COGS, including today's active queue
 * and tomorrow's pre-orders for the Sales History operations view.
 */
export function generateInitialSalesOrders(
  menuItems: MenuItem[],
  catalogMap: Map<string, CatalogItem>
): SalesOrder[] {
  const activeMenu = menuItems.filter((m) => m.isOnMenu);
  const pool = activeMenu.length > 0 ? activeMenu : menuItems;
  if (pool.length === 0) return [];

  const cogsById = new Map<string, number>();
  for (const item of pool) {
    cogsById.set(item.id, Math.round(computeMenuItemCosting(item, catalogMap, 0).cogsPerUnit));
  }

  const weights = pool.map((m, idx) => {
    if (m.estimatedMonthlySales > 0) {
      return idx === pool.length - 1
        ? Math.max(40, m.estimatedMonthlySales * 0.35)
        : m.estimatedMonthlySales;
    }
    return Math.max(50, 300 - idx * 45);
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const pickMenu = (rng: () => number): MenuItem => {
    let r = rng() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[0];
  };

  const pickSource = (rng: () => number, segment: CustomerSegment): OrderSource => {
    const r = rng();
    if (segment === 'returning') {
      if (r < 0.42) return 'Zalo / Tin nhắn';
      if (r < 0.68) return 'Khách quen / Hotline';
      if (r < 0.82) return 'Threads';
      if (r < 0.92) return 'Website đặt trực tiếp';
      return 'Facebook / Messenger';
    }
    if (r < 0.34) return 'Facebook / Messenger';
    if (r < 0.62) return 'Threads';
    if (r < 0.82) return 'Zalo / Tin nhắn';
    if (r < 0.94) return 'Website đặt trực tiếp';
    return 'Khách quen / Hotline';
  };

  const zoneCosts = (zone: DeliveryZone): { collected: number; actual: number } => {
    if (zone === 'Nội thành (<3km)') return { collected: 15000, actual: 16000 };
    if (zone === 'Trung tâm (3–7km)') return { collected: 20000, actual: 25000 };
    return { collected: 28000, actual: 36000 };
  };

  const pickCarrier = (rng: () => number, zone: DeliveryZone): ShippingCarrier => {
    const r = rng();
    if (zone === 'Nội thành (<3km)') {
      if (r < 0.40) return 'Tự giao';
      if (r < 0.68) return 'Xanh SM';
      if (r < 0.86) return 'Grab Express';
      return 'Ahamove';
    }
    if (r < 0.36) return 'Xanh SM';
    if (r < 0.68) return 'Grab Express';
    if (r < 0.90) return 'Ahamove';
    return 'Be Delivery';
  };

  const rng = seededRandom(20261125);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayISO = formatISODateLocal(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowISO = formatISODateLocal(tomorrow);

  const orders: SalesOrder[] = [];
  let seq = 1001;

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const d = new Date(today);
    d.setDate(today.getDate() - daysAgo);
    const dateStr = formatISODateLocal(d);
    const dayOfWeek = d.getDay();

    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 1.35 : dayOfWeek === 5 ? 1.2 : 1.0;
    const growthFactor = daysAgo < 30 ? 1.15 : 0.94;
    const baseOrders =
      daysAgo === 0
        ? 4
        : Math.max(1, Math.round((2 + rng() * 2.1) * weekendFactor * growthFactor));

    for (let i = 0; i < baseOrders; i++) {
      const custIdx = Math.floor(rng() * SAMPLE_CUSTOMERS.length);
      const cust = SAMPLE_CUSTOMERS[custIdx];
      const segment: CustomerSegment = rng() < (daysAgo < 30 ? 0.62 : 0.54) ? 'returning' : 'new';
      const source = pickSource(rng, segment);
      const { collected, actual } = zoneCosts(cust.zone);
      const carrier = pickCarrier(rng, cust.zone);
      const isToday = daysAgo === 0;

      const status: OrderStatus = !isToday && rng() < 0.045 ? 'cancelled' : 'completed';
      let fulfillmentStatus: FulfillmentStatus =
        status === 'cancelled' ? 'cancelled' : 'completed';
      let paymentMethod: PaymentMethod = rng() < 0.68 ? 'transfer' : 'cod';
      let paymentStatus: PaymentStatus = status === 'cancelled' ? 'unpaid' : 'paid';
      let deliverySlot = DELIVERY_SLOTS[Math.floor(rng() * DELIVERY_SLOTS.length)];

      if (isToday) {
        if (i === 0) {
          fulfillmentStatus = 'pending';
          paymentMethod = 'cod';
          paymentStatus = 'unpaid';
          deliverySlot = 'Chiều (13h–17h)';
        } else if (i === 1) {
          fulfillmentStatus = 'confirmed';
          paymentMethod = 'transfer';
          paymentStatus = 'paid';
          deliverySlot = 'Giao ngay';
        } else if (i === 2) {
          fulfillmentStatus = 'delivering';
          paymentMethod = 'cod';
          paymentStatus = 'unpaid';
          deliverySlot = 'Sáng (8h–11h)';
        } else {
          fulfillmentStatus = 'completed';
          paymentMethod = 'transfer';
          paymentStatus = 'paid';
          deliverySlot = 'Sáng (8h–11h)';
        }
      } else if (daysAgo <= 2 && i === 0 && status === 'completed') {
        // 1 recent unpaid/COD reconciliation item so the Unpaid tab shows realistic debt tracking
        paymentMethod = 'cod';
        paymentStatus = 'unpaid';
      }

      const lineCount = rng() < 0.45 ? 1 : rng() < 0.82 ? 2 : 3;
      const itemMap = new Map<string, SalesOrderItem>();
      for (let l = 0; l < lineCount; l++) {
        const dish = pickMenu(rng);
        const qty = rng() < 0.55 ? 1 : rng() < 0.85 ? 2 : 3;
        const existing = itemMap.get(dish.id);
        if (existing) {
          existing.quantity += qty;
        } else {
          itemMap.set(dish.id, {
            menuItemId: dish.id,
            code: dish.code,
            name: dish.name,
            category: dish.category,
            quantity: qty,
            unitPrice: dish.sellingPrice,
            unitCogs: cogsById.get(dish.id) ?? Math.round(dish.sellingPrice * 0.32),
          });
        }
      }

      const items = Array.from(itemMap.values());
      const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

      let discountAmount = 0;
      let shippingFeeCollected = collected;
      if (subtotal >= 150000 && rng() < 0.65) {
        shippingFeeCollected = 0;
      } else if (rng() < 0.22) {
        discountAmount = Math.min(Math.round((subtotal * 0.08) / 1000) * 1000, 15000);
      }

      const orderCode = `DH${dateStr.replace(/-/g, '').slice(2)}-${String(seq).slice(-3)}`;
      orders.push({
        id: `ord_${dateStr.replace(/-/g, '')}_${seq}`,
        orderCode,
        date: dateStr,
        deliveryDate: dateStr,
        deliverySlot,
        source,
        deliveryZone: cust.zone,
        customerSegment: segment,
        customerName: cust.name,
        customerPhone: cust.phone,
        customerAddress: cust.address,
        carrier,
        carrierTrackingCode:
          status === 'cancelled' || fulfillmentStatus === 'pending'
            ? ''
            : makeCarrierTracking(carrier, seq, rng),
        paymentMethod,
        paymentStatus,
        fulfillmentStatus,
        status,
        items,
        discountAmount: status === 'cancelled' ? 0 : discountAmount,
        shippingFeeCollected: status === 'cancelled' ? 0 : shippingFeeCollected,
        shippingCostActual: status === 'cancelled' ? 0 : actual,
        note:
          status === 'cancelled'
            ? 'Khách đổi lịch giao / hủy đơn'
            : shippingFeeCollected === 0
              ? 'Ưu đãi freeship đơn trực tiếp'
              : isToday && i === 0
                ? 'Khách dặn gọi trước 10 phút khi tới sảnh'
                : '',
      });
      seq++;
    }
  }

  // Add 2 tomorrow pre-orders so the "Đặt trước (Pre-order)" tab is immediately useful
  for (let p = 0; p < 2; p++) {
    const cust = SAMPLE_CUSTOMERS[p];
    const dish = pool[p % pool.length];
    const { collected, actual } = zoneCosts(cust.zone);
    const preCode = `DH${tomorrowISO.replace(/-/g, '').slice(2)}-${String(seq).slice(-3)}`;
    orders.push({
      id: `ord_${tomorrowISO.replace(/-/g, '')}_${seq}`,
      orderCode: preCode,
      date: todayISO,
      deliveryDate: tomorrowISO,
      deliverySlot: p === 0 ? 'Sáng (8h–11h)' : 'Chiều (13h–17h)',
      source: p === 0 ? 'Zalo / Tin nhắn' : 'Threads',
      deliveryZone: cust.zone,
      customerSegment: 'returning',
      customerName: cust.name,
      customerPhone: cust.phone,
      customerAddress: cust.address,
      carrier: p === 0 ? 'Xanh SM' : 'Grab Express',
      carrierTrackingCode: '',
      paymentMethod: p === 0 ? 'transfer' : 'cod',
      paymentStatus: p === 0 ? 'paid' : 'unpaid',
      fulfillmentStatus: 'confirmed',
      status: 'completed',
      items: [
        {
          menuItemId: dish.id,
          code: dish.code,
          name: dish.name,
          category: dish.category,
          quantity: p === 0 ? 2 : 3,
          unitPrice: dish.sellingPrice,
          unitCogs: cogsById.get(dish.id) ?? Math.round(dish.sellingPrice * 0.32),
        },
      ],
      discountAmount: 0,
      shippingFeeCollected: collected,
      shippingCostActual: actual,
      note: p === 0 ? 'Đặt trước giao sáng mai cho văn phòng' : 'Hẹn giao chiều mai, ít đường / ít đá',
    });
    seq++;
  }

  return orders.sort(
    (a, b) =>
      (b.deliveryDate || b.date).localeCompare(a.deliveryDate || a.date) ||
      b.date.localeCompare(a.date) ||
      b.orderCode.localeCompare(a.orderCode)
  );
}
