import {
  CatalogItem,
  CustomerSegment,
  DeliveryZone,
  MenuItem,
  OrderSource,
  OrderStatus,
  SalesOrder,
  SalesOrderItem,
  SalesTargetConfig,
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
  'Website đặt trực tiếp',
  'Khách quen / Hotline',
];

export const DELIVERY_ZONES: DeliveryZone[] = [
  'Nội thành (<3km)',
  'Trung tâm (3–7km)',
  'Ngoại thành (>7km)',
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

/**
 * Generates a realistic, deterministic 60-day history of direct-online self-delivered orders
 * grounded in the current menu items & real recipe COGS so all date ranges (Today, 7d, Month,
 * Quarter, MoM/WoW comparison, Top Sellers, Slow Movers, New vs Returning) work immediately.
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

  // Build weighted menu selection so some items are clear best-sellers and 1-2 items are slow movers
  const weights = pool.map((m, idx) => {
    if (m.estimatedMonthlySales > 0) {
      // Slightly amplify contrast so best-seller / slow-mover analytics are insightful
      return idx === pool.length - 1 ? Math.max(40, m.estimatedMonthlySales * 0.35) : m.estimatedMonthlySales;
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
      if (r < 0.44) return 'Zalo / Tin nhắn';
      if (r < 0.72) return 'Khách quen / Hotline';
      if (r < 0.88) return 'Website đặt trực tiếp';
      return 'Facebook / Messenger';
    }
    if (r < 0.42) return 'Facebook / Messenger';
    if (r < 0.72) return 'Zalo / Tin nhắn';
    if (r < 0.90) return 'Website đặt trực tiếp';
    return 'Khách quen / Hotline';
  };

  const pickZone = (rng: () => number): { zone: DeliveryZone; collected: number; actual: number } => {
    const r = rng();
    if (r < 0.56) {
      return { zone: 'Nội thành (<3km)', collected: 15000, actual: 16000 };
    }
    if (r < 0.86) {
      return { zone: 'Trung tâm (3–7km)', collected: 20000, actual: 25000 };
    }
    return { zone: 'Ngoại thành (>7km)', collected: 28000, actual: 36000 };
  };

  const rng = seededRandom(20261125);
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const orders: SalesOrder[] = [];
  let seq = 1001;

  // Generate 60 days of history (daysAgo = 59 down to 0)
  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const d = new Date(today);
    d.setDate(today.getDate() - daysAgo);
    const dateStr = formatISODateLocal(d);
    const dayOfWeek = d.getDay(); // 0 Sun .. 6 Sat

    // Weekend & Friday boost + gentle growth trend in the latest 30 days
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 1.35 : dayOfWeek === 5 ? 1.2 : 1.0;
    const growthFactor = daysAgo < 30 ? 1.15 : 0.94;
    const baseOrders = Math.max(1, Math.round((2 + rng() * 2.1) * weekendFactor * growthFactor));

    for (let i = 0; i < baseOrders; i++) {
      const segment: CustomerSegment = rng() < (daysAgo < 30 ? 0.62 : 0.54) ? 'returning' : 'new';
      const source = pickSource(rng, segment);
      const { zone, collected, actual } = pickZone(rng);
      const status: OrderStatus = rng() < 0.045 ? 'cancelled' : 'completed';

      // 1 to 3 distinct menu lines per online delivery order (group/office/family orders)
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

      // Freeship / combo voucher for orders >= 120k or occasional promo
      let discountAmount = 0;
      let shippingFeeCollected = collected;
      if (subtotal >= 150000 && rng() < 0.65) {
        shippingFeeCollected = 0; // Freeship tự giao cho đơn lớn
      } else if (rng() < 0.22) {
        discountAmount = Math.min(Math.round(subtotal * 0.08 / 1000) * 1000, 15000);
      }

      const orderCode = `DH${dateStr.replace(/-/g, '').slice(2)}-${String(seq).slice(-3)}`;
      orders.push({
        id: `ord_${dateStr.replace(/-/g, '')}_${seq}`,
        orderCode,
        date: dateStr,
        source,
        deliveryZone: zone,
        customerSegment: segment,
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
              : '',
      });
      seq++;
    }
  }

  return orders.sort((a, b) => b.date.localeCompare(a.date) || b.orderCode.localeCompare(a.orderCode));
}
