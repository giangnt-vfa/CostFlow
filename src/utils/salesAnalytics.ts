import {
  CatalogItem,
  DeliveryZone,
  MenuItem,
  OrderSource,
  SalesOrder,
  SalesTargetConfig,
  SalesTargetPeriod,
} from '../types/costing';
import { computeMenuItemCosting } from './formatters';

export type DateRangePreset = 'today' | '7d' | 'month' | 'quarter' | 'year' | 'custom';
export type TrendGranularity = 'day' | 'week' | 'month';

export interface SalesFilterState {
  preset: DateRangePreset;
  customStart: string;
  customEnd: string;
  source: OrderSource | 'Tất cả';
  zone: DeliveryZone | 'Tất cả';
  category: string; // 'Tất cả' or category
  menuItemId: string; // 'Tất cả' or menuItem.id
}

export interface DateWindow {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  prevStart: string;
  prevEnd: string;
  daysCount: number;
  label: string;
  comparisonLabel: string;
}

export function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDaysISO(iso: string, delta: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + delta);
  return formatISODate(d);
}

export function resolveDateWindow(
  preset: DateRangePreset,
  customStart: string,
  customEnd: string
): DateWindow {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const todayISO = formatISODate(now);

  let start = todayISO;
  let end = todayISO;
  let label = 'Hôm nay';
  let comparisonLabel = 'so với hôm qua';

  if (preset === 'today') {
    start = todayISO;
    end = todayISO;
    label = 'Hôm nay';
    comparisonLabel = 'so với hôm qua';
  } else if (preset === '7d') {
    start = addDaysISO(todayISO, -6);
    end = todayISO;
    label = '7 ngày qua';
    comparisonLabel = 'so với 7 ngày trước';
  } else if (preset === 'month') {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
    start = formatISODate(firstOfMonth);
    end = todayISO;
    label = 'Tháng này';
    comparisonLabel = 'so với cùng kỳ trước';
  } else if (preset === 'quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const firstOfQ = new Date(now.getFullYear(), qStartMonth, 1, 12, 0, 0, 0);
    start = formatISODate(firstOfQ);
    end = todayISO;
    label = 'Quý này';
    comparisonLabel = 'so với kỳ trước';
  } else if (preset === 'year') {
    const firstOfY = new Date(now.getFullYear(), 0, 1, 12, 0, 0, 0);
    start = formatISODate(firstOfY);
    end = todayISO;
    label = 'Năm nay';
    comparisonLabel = 'so với kỳ trước';
  } else {
    const s = customStart || addDaysISO(todayISO, -29);
    const e = customEnd || todayISO;
    start = s <= e ? s : e;
    end = s <= e ? e : s;
    label = `${start} → ${end}`;
    comparisonLabel = 'so với kỳ liền trước';
  }

  const startMs = parseISODate(start).getTime();
  const endMs = parseISODate(end).getTime();
  const daysCount = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  const prevEnd = addDaysISO(start, -1);
  const prevStart = addDaysISO(prevEnd, -(daysCount - 1));

  return {
    start,
    end,
    prevStart,
    prevEnd,
    daysCount,
    label,
    comparisonLabel,
  };
}

export interface OrderAttributedMetrics {
  order: SalesOrder;
  matchedGross: number; // Giá trị món khớp bộ lọc trước giảm giá
  matchedNet: number; // Thực thu (0 nếu đơn hủy)
  matchedCogs: number; // Tổng giá vốn món khớp (0 nếu đơn hủy)
  matchedDiscount: number; // Phần giảm giá phân bổ
  matchedShippingSubsidy: number; // Phần cửa hàng bù ship phân bổ (actual - collected)
  matchedGrossProfit: number; // matchedNet - matchedCogs - matchedShippingSubsidy
  matchedUnits: number;
}

/**
 * Computes order metrics attributed accurately to the active Category / MenuItem filter.
 * If no product filter is active, share === 1.
 */
export function attributeOrder(
  order: SalesOrder,
  category: string,
  menuItemId: string
): OrderAttributedMetrics | null {
  const fullSubtotal = order.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const matchingItems = order.items.filter((it) => {
    if (menuItemId !== 'Tất cả' && it.menuItemId !== menuItemId) return false;
    if (category !== 'Tất cả' && it.category !== category) return false;
    return true;
  });

  if (matchingItems.length === 0) return null;

  const matchedGross = matchingItems.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const matchedUnits = matchingItems.reduce((s, it) => s + it.quantity, 0);
  const share = fullSubtotal > 0 ? matchedGross / fullSubtotal : 1;

  if (order.status === 'cancelled') {
    return {
      order,
      matchedGross,
      matchedNet: 0,
      matchedCogs: 0,
      matchedDiscount: 0,
      matchedShippingSubsidy: 0,
      matchedGrossProfit: 0,
      matchedUnits: 0,
    };
  }

  const matchedDiscount = (order.discountAmount || 0) * share;
  const matchedNet = Math.max(0, matchedGross - matchedDiscount);
  const matchedCogs = matchingItems.reduce((s, it) => s + it.unitCogs * it.quantity, 0);
  const rawSubsidy = Math.max(0, (order.shippingCostActual || 0) - (order.shippingFeeCollected || 0));
  const matchedShippingSubsidy = rawSubsidy * share;
  const matchedGrossProfit = matchedNet - matchedCogs - matchedShippingSubsidy;

  return {
    order,
    matchedGross,
    matchedNet,
    matchedCogs,
    matchedDiscount,
    matchedShippingSubsidy,
    matchedGrossProfit,
    matchedUnits,
  };
}

export interface PeriodSummary {
  grossRevenue: number;
  netRevenue: number;
  totalDiscount: number;
  cancelledValue: number;
  totalCogs: number;
  totalShippingSubsidy: number;
  grossProfit: number;
  grossMarginPct: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalUnits: number;
  aov: number;
  cancellationRatePct: number;
  newRevenue: number;
  returningRevenue: number;
  newOrders: number;
  returningOrders: number;
  returningRevenueSharePct: number;
  newAov: number;
  returningAov: number;
}

export function summarizeAttributedOrders(list: OrderAttributedMetrics[]): PeriodSummary {
  let grossRevenue = 0;
  let netRevenue = 0;
  let totalDiscount = 0;
  let cancelledValue = 0;
  let totalCogs = 0;
  let totalShippingSubsidy = 0;
  let grossProfit = 0;
  let completedOrders = 0;
  let cancelledOrders = 0;
  let totalUnits = 0;
  let newRevenue = 0;
  let returningRevenue = 0;
  let newOrders = 0;
  let returningOrders = 0;

  for (const row of list) {
    grossRevenue += row.matchedGross;
    if (row.order.status === 'cancelled') {
      cancelledOrders += 1;
      cancelledValue += row.matchedGross;
    } else {
      completedOrders += 1;
      netRevenue += row.matchedNet;
      totalDiscount += row.matchedDiscount;
      totalCogs += row.matchedCogs;
      totalShippingSubsidy += row.matchedShippingSubsidy;
      grossProfit += row.matchedGrossProfit;
      totalUnits += row.matchedUnits;
      if (row.order.customerSegment === 'new') {
        newRevenue += row.matchedNet;
        newOrders += 1;
      } else {
        returningRevenue += row.matchedNet;
        returningOrders += 1;
      }
    }
  }

  const totalOrders = completedOrders + cancelledOrders;
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const aov = completedOrders > 0 ? netRevenue / completedOrders : 0;
  const cancellationRatePct = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0;
  const returningRevenueSharePct = netRevenue > 0 ? (returningRevenue / netRevenue) * 100 : 0;
  const newAov = newOrders > 0 ? newRevenue / newOrders : 0;
  const returningAov = returningOrders > 0 ? returningRevenue / returningOrders : 0;

  return {
    grossRevenue,
    netRevenue,
    totalDiscount,
    cancelledValue,
    totalCogs,
    totalShippingSubsidy,
    grossProfit,
    grossMarginPct,
    totalOrders,
    completedOrders,
    cancelledOrders,
    totalUnits,
    aov,
    cancellationRatePct,
    newRevenue,
    returningRevenue,
    newOrders,
    returningOrders,
    returningRevenueSharePct,
    newAov,
    returningAov,
  };
}

export function calcDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export interface TrendBucketPoint {
  key: string;
  label: string;
  currentRevenue: number;
  previousRevenue: number;
  grossProfit: number;
  orders: number;
  units: number;
  newRevenue: number;
  returningRevenue: number;
}

function getBucketKeyAndLabel(isoDate: string, granularity: TrendGranularity): { key: string; label: string } {
  const d = parseISODate(isoDate);
  if (granularity === 'month') {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return { key: `${y}-${m}`, label: `T${m}/${String(y).slice(2)}` };
  }
  if (granularity === 'week') {
    // Monday-based week start
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    const key = formatISODate(mon);
    const dd = String(mon.getDate()).padStart(2, '0');
    const mm = String(mon.getMonth() + 1).padStart(2, '0');
    return { key, label: `Tuần ${dd}/${mm}` };
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { key: isoDate, label: `${dd}/${mm}` };
}

export function buildTrendSeries(
  currentAttributed: OrderAttributedMetrics[],
  previousAttributed: OrderAttributedMetrics[],
  window: DateWindow,
  granularity: TrendGranularity
): TrendBucketPoint[] {
  const buckets = new Map<string, TrendBucketPoint>();

  // Pre-seed every day/week/month in the active window so charts have zero missing gaps
  for (let i = 0; i < window.daysCount; i++) {
    const iso = addDaysISO(window.start, i);
    const { key, label } = getBucketKeyAndLabel(iso, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        currentRevenue: 0,
        previousRevenue: 0,
        grossProfit: 0,
        orders: 0,
        units: 0,
        newRevenue: 0,
        returningRevenue: 0,
      });
    }
  }

  for (const row of currentAttributed) {
    if (row.order.status === 'cancelled') continue;
    const { key, label } = getBucketKeyAndLabel(row.order.date, granularity);
    const b = buckets.get(key) || {
      key,
      label,
      currentRevenue: 0,
      previousRevenue: 0,
      grossProfit: 0,
      orders: 0,
      units: 0,
      newRevenue: 0,
      returningRevenue: 0,
    };
    b.currentRevenue += row.matchedNet;
    b.grossProfit += row.matchedGrossProfit;
    b.orders += 1;
    b.units += row.matchedUnits;
    if (row.order.customerSegment === 'new') {
      b.newRevenue += row.matchedNet;
    } else {
      b.returningRevenue += row.matchedNet;
    }
    buckets.set(key, b);
  }

  // Shift previous period dates forward by window.daysCount so they overlay 1-to-1 on the same X axis
  for (const row of previousAttributed) {
    if (row.order.status === 'cancelled') continue;
    const shiftedDate = addDaysISO(row.order.date, window.daysCount);
    const { key } = getBucketKeyAndLabel(shiftedDate, granularity);
    const b = buckets.get(key);
    if (b) {
      b.previousRevenue += row.matchedNet;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export interface ProductPerformanceRow {
  menuItemId: string;
  code: string;
  name: string;
  category: string;
  unitsSold: number;
  ordersCount: number;
  grossRevenue: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  revenueSharePct: number;
  isOnMenu: boolean;
}

export function buildProductPerformance(
  currentOrders: SalesOrder[],
  menuItems: MenuItem[],
  categoryFilter: string
): ProductPerformanceRow[] {
  const map = new Map<string, ProductPerformanceRow>();

  // Pre-seed menu items matching category filter so slow/zero-sale dishes appear clearly
  for (const m of menuItems) {
    if (categoryFilter !== 'Tất cả' && m.category !== categoryFilter) continue;
    map.set(m.id, {
      menuItemId: m.id,
      code: m.code,
      name: m.name,
      category: m.category,
      unitsSold: 0,
      ordersCount: 0,
      grossRevenue: 0,
      netRevenue: 0,
      cogs: 0,
      grossProfit: 0,
      marginPct: 0,
      revenueSharePct: 0,
      isOnMenu: m.isOnMenu,
    });
  }

  let totalNet = 0;

  for (const order of currentOrders) {
    if (order.status === 'cancelled') continue;
    const fullSubtotal = order.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const rawSubsidy = Math.max(0, (order.shippingCostActual || 0) - (order.shippingFeeCollected || 0));

    for (const it of order.items) {
      if (categoryFilter !== 'Tất cả' && it.category !== categoryFilter) continue;
      const lineGross = it.unitPrice * it.quantity;
      const share = fullSubtotal > 0 ? lineGross / fullSubtotal : 0;
      const lineNet = Math.max(0, lineGross - (order.discountAmount || 0) * share);
      const lineCogs = it.unitCogs * it.quantity;
      const lineSubsidy = rawSubsidy * share;

      const existing = map.get(it.menuItemId) || {
        menuItemId: it.menuItemId,
        code: it.code,
        name: it.name,
        category: it.category,
        unitsSold: 0,
        ordersCount: 0,
        grossRevenue: 0,
        netRevenue: 0,
        cogs: 0,
        grossProfit: 0,
        marginPct: 0,
        revenueSharePct: 0,
        isOnMenu: false,
      };
      existing.unitsSold += it.quantity;
      existing.ordersCount += 1;
      existing.grossRevenue += lineGross;
      existing.netRevenue += lineNet;
      existing.cogs += lineCogs;
      existing.grossProfit += lineNet - lineCogs - lineSubsidy;
      map.set(it.menuItemId, existing);
      totalNet += lineNet;
    }
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      marginPct: row.netRevenue > 0 ? (row.grossProfit / row.netRevenue) * 100 : 0,
      revenueSharePct: totalNet > 0 ? (row.netRevenue / totalNet) * 100 : 0,
    }))
    .sort((a, b) => b.netRevenue - a.netRevenue || b.unitsSold - a.unitsSold);
}

export interface BreakdownSlice {
  name: string;
  revenue: number;
  orders: number;
  units: number;
  shippingSubsidy: number;
  sharePct: number;
}

export function buildDimensionBreakdown(
  attributed: OrderAttributedMetrics[],
  selector: (o: SalesOrder) => string
): BreakdownSlice[] {
  const map = new Map<string, BreakdownSlice>();
  let totalRev = 0;

  for (const row of attributed) {
    if (row.order.status === 'cancelled') continue;
    const key = selector(row.order);
    const curr = map.get(key) || {
      name: key,
      revenue: 0,
      orders: 0,
      units: 0,
      shippingSubsidy: 0,
      sharePct: 0,
    };
    curr.revenue += row.matchedNet;
    curr.orders += 1;
    curr.units += row.matchedUnits;
    curr.shippingSubsidy += row.matchedShippingSubsidy;
    map.set(key, curr);
    totalRev += row.matchedNet;
  }

  return Array.from(map.values())
    .map((s) => ({
      ...s,
      sharePct: totalRev > 0 ? (s.revenue / totalRev) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface TargetPlanCalculation {
  period: SalesTargetPeriod;
  periodLabel: string;
  periodDays: number;
  avgPricePerUnit: number;
  avgContributionPerUnit: number; // Lãi gộp bình quân mỗi phần/ly sau giảm giá & bù ship
  periodOverhead: number;
  breakEvenUnits: number;
  targetUnitsForPeriod: number;
  targetUnitsPerDay: number;
  targetUnitsPerWeek: number;
  targetUnitsPerMonth: number;
  targetRevenueForPeriod: number;
  expectedNetProfitForPeriod: number;
  actualUnitsInPeriod: number;
  actualRevenueInPeriod: number;
  actualGrossProfitInPeriod: number;
  actualNetProfitInPeriod: number;
  unitsProgressPct: number;
  revenueProgressPct: number;
  breakEvenMarkerPct: number;
  remainingUnits: number;
}

export function computeSalesTargetPlan(
  targetConfig: SalesTargetConfig,
  allOrders: SalesOrder[],
  menuItems: MenuItem[],
  catalogMap: Map<string, CatalogItem>,
  totalMonthlyOverhead: number
): TargetPlanCalculation {
  const period = targetConfig.period;
  const periodDays = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  const periodLabel = period === 'day' ? 'Hôm nay' : period === 'week' ? '7 ngày qua' : 'Tháng này';
  const periodFraction = period === 'day' ? 1 / 30 : period === 'week' ? 7 / 30 : 1;

  // Derive real weighted average unit economics from last 30 days completed orders, fallback to active menu
  const todayISO = formatISODate(new Date());
  const start30ISO = addDaysISO(todayISO, -29);
  const recentCompleted = allOrders.filter(
    (o) => o.status === 'completed' && o.date >= start30ISO && o.date <= todayISO
  );

  let avgPricePerUnit = 0;
  let avgContributionPerUnit = 0;

  const recentUnits = recentCompleted.reduce(
    (s, o) => s + o.items.reduce((is, it) => is + it.quantity, 0),
    0
  );

  if (recentUnits > 0) {
    const recentSummary = summarizeAttributedOrders(
      recentCompleted
        .map((o) => attributeOrder(o, 'Tất cả', 'Tất cả'))
        .filter((x): x is OrderAttributedMetrics => x !== null)
    );
    avgPricePerUnit = recentSummary.netRevenue / recentUnits;
    avgContributionPerUnit = recentSummary.grossProfit / recentUnits;
  } else {
    const activeMenu = menuItems.filter((m) => m.isOnMenu);
    const pool = activeMenu.length > 0 ? activeMenu : menuItems;
    if (pool.length > 0) {
      const totalWeights = pool.reduce((s, m) => s + Math.max(1, m.estimatedMonthlySales || 1), 0);
      for (const m of pool) {
        const w = Math.max(1, m.estimatedMonthlySales || 1) / totalWeights;
        const c = computeMenuItemCosting(m, catalogMap, 0);
        avgPricePerUnit += m.sellingPrice * w;
        avgContributionPerUnit += Math.max(0, m.sellingPrice - c.cogsPerUnit) * w;
      }
    }
  }

  const safeContribution = Math.max(1000, avgContributionPerUnit || 25000);
  const safePrice = Math.max(1000, avgPricePerUnit || 45000);

  const periodOverhead = totalMonthlyOverhead * periodFraction;
  const breakEvenMonthlyUnits = Math.ceil(totalMonthlyOverhead / safeContribution);
  const breakEvenUnits = Math.ceil(periodOverhead / safeContribution);

  let targetUnitsPerMonth: number;
  let expectedMonthlyNetProfit: number;

  if (targetConfig.mode === 'profit') {
    expectedMonthlyNetProfit = Math.max(0, targetConfig.targetMonthlyProfit || 0);
    targetUnitsPerMonth = Math.ceil((totalMonthlyOverhead + expectedMonthlyNetProfit) / safeContribution);
  } else {
    targetUnitsPerMonth = Math.max(1, Math.round(targetConfig.targetMonthlyUnits || breakEvenMonthlyUnits));
    expectedMonthlyNetProfit = targetUnitsPerMonth * safeContribution - totalMonthlyOverhead;
  }

  const targetUnitsForPeriod = Math.max(1, Math.ceil(targetUnitsPerMonth * periodFraction));
  const targetUnitsPerDay = Math.max(1, Math.ceil(targetUnitsPerMonth / 30));
  const targetUnitsPerWeek = Math.max(1, Math.ceil((targetUnitsPerMonth * 7) / 30));
  const targetRevenueForPeriod = targetUnitsForPeriod * safePrice;
  const expectedNetProfitForPeriod = expectedMonthlyNetProfit * periodFraction;

  // Measure actual performance for the selected target period (Today, Last 7 days, or Current Month)
  const preset: DateRangePreset = period === 'day' ? 'today' : period === 'week' ? '7d' : 'month';
  const win = resolveDateWindow(preset, '', '');
  const periodOrders = allOrders
    .filter((o) => o.date >= win.start && o.date <= win.end)
    .map((o) => attributeOrder(o, 'Tất cả', 'Tất cả'))
    .filter((x): x is OrderAttributedMetrics => x !== null);
  const actualSummary = summarizeAttributedOrders(periodOrders);

  const unitsProgressPct =
    targetUnitsForPeriod > 0 ? (actualSummary.totalUnits / targetUnitsForPeriod) * 100 : 0;
  const revenueProgressPct =
    targetRevenueForPeriod > 0 ? (actualSummary.netRevenue / targetRevenueForPeriod) * 100 : 0;
  const breakEvenMarkerPct =
    targetUnitsForPeriod > 0 ? Math.min(100, (breakEvenUnits / targetUnitsForPeriod) * 100) : 0;
  const remainingUnits = Math.max(0, targetUnitsForPeriod - actualSummary.totalUnits);

  return {
    period,
    periodLabel,
    periodDays,
    avgPricePerUnit: safePrice,
    avgContributionPerUnit: safeContribution,
    periodOverhead,
    breakEvenUnits,
    targetUnitsForPeriod,
    targetUnitsPerDay,
    targetUnitsPerWeek,
    targetUnitsPerMonth,
    targetRevenueForPeriod,
    expectedNetProfitForPeriod,
    actualUnitsInPeriod: actualSummary.totalUnits,
    actualRevenueInPeriod: actualSummary.netRevenue,
    actualGrossProfitInPeriod: actualSummary.grossProfit,
    actualNetProfitInPeriod: actualSummary.grossProfit - periodOverhead,
    unitsProgressPct,
    revenueProgressPct,
    breakEvenMarkerPct,
    remainingUnits,
  };
}

export function exportSkuPerformanceCSV(rows: ProductPerformanceRow[]): string {
  const headers = [
    'Mã món',
    'Tên món',
    'Danh mục',
    'Số lượng bán',
    'Số đơn có món',
    'Tổng doanh thu (Gross)',
    'Doanh thu thuần (Net)',
    'Giá vốn (COGS)',
    'Lợi nhuận gộp',
    'Biên LN gộp (%)',
    'Tỷ trọng DT (%)',
  ];
  const lines = rows.map((r) => [
    r.code,
    r.name,
    r.category,
    String(r.unitsSold),
    String(r.ordersCount),
    String(Math.round(r.grossRevenue)),
    String(Math.round(r.netRevenue)),
    String(Math.round(r.cogs)),
    String(Math.round(r.grossProfit)),
    r.marginPct.toFixed(1),
    r.revenueSharePct.toFixed(1),
  ]);
  return [headers, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

export function exportSalesOrdersCSV(orders: SalesOrder[]): string {
  const headers = [
    'Mã đơn',
    'Ngày bán',
    'Nguồn online',
    'Khu vực ship',
    'Khách hàng',
    'Trạng thái',
    'Chi tiết món',
    'Tổng số lượng',
    'Tổng tiền món (Gross)',
    'Giảm giá',
    'Doanh thu thuần (Net)',
    'Thu ship khách',
    'Trả shipper',
    'Ghi chú',
  ];
  const lines = orders.map((o) => {
    const gross = o.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const qty = o.items.reduce((s, it) => s + it.quantity, 0);
    const net = o.status === 'cancelled' ? 0 : Math.max(0, gross - (o.discountAmount || 0));
    const detail = o.items.map((it) => `${it.name} x${it.quantity}`).join('; ');
    return [
      o.orderCode,
      o.date,
      o.source,
      o.deliveryZone,
      o.customerSegment === 'new' ? 'Khách mới' : 'Khách quay lại',
      o.status === 'completed' ? 'Hoàn tất' : 'Đã hủy / Hoàn',
      detail,
      String(qty),
      String(Math.round(gross)),
      String(Math.round(o.discountAmount || 0)),
      String(Math.round(net)),
      String(Math.round(o.shippingFeeCollected || 0)),
      String(Math.round(o.shippingCostActual || 0)),
      o.note || '',
    ];
  });
  return [headers, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
