import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Download,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DELIVERY_ZONES, ORDER_SOURCES } from '../data/initialSalesData';
import {
  CatalogItem,
  DeliveryZone,
  MenuItem,
  OrderSource,
  SalesOrder,
  SalesTargetConfig,
  SalesTargetMode,
  SalesTargetPeriod,
} from '../types/costing';
import {
  formatNumber,
  formatPercent,
  formatVND,
  normalizeVietnamese,
  triggerDownloadCSV,
} from '../utils/formatters';
import {
  DateRangePreset,
  OrderAttributedMetrics,
  SalesFilterState,
  TrendGranularity,
  addDaysISO,
  attributeOrder,
  buildDimensionBreakdown,
  buildProductPerformance,
  buildTrendSeries,
  calcDeltaPct,
  computeSalesTargetPlan,
  exportSkuPerformanceCSV,
  formatISODate,
  resolveDateWindow,
  summarizeAttributedOrders,
} from '../utils/salesAnalytics';
import { SalesOrderModal } from './SalesOrderModal';

interface SalesAnalyticsViewProps {
  salesOrders: SalesOrder[];
  salesTarget: SalesTargetConfig;
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  totalMonthlyOverhead: number;
  onAddSalesOrder: (order: Omit<SalesOrder, 'id'>) => void;
  onUpdateSalesTarget: (patch: Partial<SalesTargetConfig>) => void;
  onOpenSalesHistory?: () => void;
}

const DATE_PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: 'today', label: 'Hôm nay' },
  { id: '7d', label: '7 ngày' },
  { id: 'month', label: 'Tháng này' },
  { id: 'quarter', label: 'Quý này' },
  { id: 'year', label: 'Năm nay' },
  { id: 'custom', label: 'Tùy chỉnh' },
];

type SkuSortKey = 'netRevenue' | 'unitsSold' | 'grossProfit' | 'marginPct' | 'revenueSharePct';

function formatCompactVND(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} tỷ`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function DeltaIndicator({
  deltaPct,
  invertColors = false,
  suffix = '',
}: {
  deltaPct: number | null;
  invertColors?: boolean;
  suffix?: string;
}) {
  if (deltaPct === null) {
    return <span className="text-xs text-slate-400">Chưa có kỳ trước</span>;
  }
  const rounded = Number(deltaPct.toFixed(1));
  if (rounded === 0) {
    return <span className="text-xs font-mono-num text-slate-500">0,0% {suffix}</span>;
  }
  const isPositive = rounded > 0;
  const isGood = invertColors ? !isPositive : isPositive;
  const colorClass = isGood ? 'text-emerald-700' : 'text-red-600';
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-mono-num font-medium ${colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>
        {isPositive ? '+' : ''}
        {rounded.toFixed(1)}%
      </span>
      {suffix && <span className="font-sans font-normal text-slate-500 ml-0.5">{suffix}</span>}
    </span>
  );
}

export function SalesAnalyticsView({
  salesOrders,
  salesTarget,
  menuItems,
  catalogMap,
  totalMonthlyOverhead,
  onAddSalesOrder,
  onUpdateSalesTarget,
  onOpenSalesHistory,
}: SalesAnalyticsViewProps) {
  const todayISO = useMemo(() => formatISODate(new Date()), []);

  // 1. Global Filter State
  const [filters, setFilters] = useState<SalesFilterState>({
    preset: 'month',
    customStart: addDaysISO(todayISO, -29),
    customEnd: todayISO,
    source: 'Tất cả',
    zone: 'Tất cả',
    category: 'Tất cả',
    menuItemId: 'Tất cả',
  });

  // Chart & Table View Controls
  const [granularity, setGranularity] = useState<TrendGranularity>('day');
  const [showProfitLine, setShowProfitLine] = useState(false);
  const [productRankMode, setProductRankMode] = useState<'top' | 'slow'>('top');
  const [tableSearch, setTableSearch] = useState('');
  const [skuSort, setSkuSort] = useState<{ key: SkuSortKey; dir: 'desc' | 'asc' }>({
    key: 'netRevenue',
    dir: 'desc',
  });
  const [orderModalOpen, setOrderModalOpen] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of menuItems) set.add(m.category);
    for (const o of salesOrders) {
      for (const it of o.items) set.add(it.category);
    }
    return ['Tất cả', ...Array.from(set)];
  }, [menuItems, salesOrders]);

  const menuOptions = useMemo(() => {
    return menuItems.filter(
      (m) => filters.category === 'Tất cả' || m.category === filters.category
    );
  }, [menuItems, filters.category]);

  const dateWindow = useMemo(
    () => resolveDateWindow(filters.preset, filters.customStart, filters.customEnd),
    [filters.preset, filters.customStart, filters.customEnd]
  );

  const handlePresetChange = (preset: DateRangePreset) => {
    setFilters((prev) => ({ ...prev, preset }));
    if (preset === 'year') {
      setGranularity('month');
    } else if (preset === 'quarter') {
      setGranularity('week');
    } else {
      setGranularity('day');
    }
  };

  // Base orders matching Source & Zone (before Date & Product filter)
  const channelFilteredOrders = useMemo(() => {
    return salesOrders.filter((o) => {
      if (filters.source !== 'Tất cả' && o.source !== filters.source) return false;
      if (filters.zone !== 'Tất cả' && o.deliveryZone !== filters.zone) return false;
      return true;
    });
  }, [salesOrders, filters.source, filters.zone]);

  // Current & Previous Period Attributed Orders
  const currentPeriodOrdersRaw = useMemo(
    () =>
      channelFilteredOrders.filter(
        (o) => o.date >= dateWindow.start && o.date <= dateWindow.end
      ),
    [channelFilteredOrders, dateWindow.start, dateWindow.end]
  );

  const currentAttributed = useMemo(() => {
    return currentPeriodOrdersRaw
      .map((o) => attributeOrder(o, filters.category, filters.menuItemId))
      .filter((x): x is OrderAttributedMetrics => x !== null);
  }, [currentPeriodOrdersRaw, filters.category, filters.menuItemId]);

  const previousAttributed = useMemo(() => {
    return channelFilteredOrders
      .filter((o) => o.date >= dateWindow.prevStart && o.date <= dateWindow.prevEnd)
      .map((o) => attributeOrder(o, filters.category, filters.menuItemId))
      .filter((x): x is OrderAttributedMetrics => x !== null);
  }, [channelFilteredOrders, dateWindow.prevStart, dateWindow.prevEnd, filters.category, filters.menuItemId]);

  // 2. KPI Summary + Comparison Deltas
  const currentSummary = useMemo(
    () => summarizeAttributedOrders(currentAttributed),
    [currentAttributed]
  );
  const previousSummary = useMemo(
    () => summarizeAttributedOrders(previousAttributed),
    [previousAttributed]
  );

  const kpiDeltas = useMemo(
    () => ({
      netRevenue: calcDeltaPct(currentSummary.netRevenue, previousSummary.netRevenue),
      grossProfit: calcDeltaPct(currentSummary.grossProfit, previousSummary.grossProfit),
      completedOrders: calcDeltaPct(
        currentSummary.completedOrders,
        previousSummary.completedOrders
      ),
      aov: calcDeltaPct(currentSummary.aov, previousSummary.aov),
      cancellationRate:
        previousSummary.totalOrders > 0
          ? currentSummary.cancellationRatePct - previousSummary.cancellationRatePct
          : null,
    }),
    [currentSummary, previousSummary]
  );

  // 3. Trend Series (Combo Chart + Stacked Retention Chart)
  const trendSeries = useMemo(
    () => buildTrendSeries(currentAttributed, previousAttributed, dateWindow, granularity),
    [currentAttributed, previousAttributed, dateWindow, granularity]
  );

  // 4. Profit-to-Volume Target Planner
  const targetPlan = useMemo(
    () =>
      computeSalesTargetPlan(
        salesTarget,
        salesOrders,
        menuItems,
        catalogMap,
        totalMonthlyOverhead
      ),
    [salesTarget, salesOrders, menuItems, catalogMap, totalMonthlyOverhead]
  );

  // 5. Product Ranking (Top Sellers & Slow Movers)
  const allProductPerf = useMemo(
    () => buildProductPerformance(currentPeriodOrdersRaw, menuItems, filters.category),
    [currentPeriodOrdersRaw, menuItems, filters.category]
  );

  const rankedProductsChart = useMemo(() => {
    if (productRankMode === 'top') {
      return allProductPerf
        .filter((p) => p.unitsSold > 0)
        .slice(0, 8)
        .map((p) => ({
          ...p,
          shortName: p.name.length > 26 ? `${p.name.slice(0, 25)}…` : p.name,
        }));
    }
    return [...allProductPerf]
      .sort((a, b) => a.unitsSold - b.unitsSold || a.netRevenue - b.netRevenue)
      .slice(0, 8)
      .map((p) => ({
        ...p,
        shortName: p.name.length > 26 ? `${p.name.slice(0, 25)}…` : p.name,
      }));
  }, [allProductPerf, productRankMode]);

  // 6. Direct Channel Breakdowns (Delivery Zones & Order Sources & Commission Savings)
  const zoneBreakdown = useMemo(
    () => buildDimensionBreakdown(currentAttributed, (o) => o.deliveryZone),
    [currentAttributed]
  );
  const sourceBreakdown = useMemo(
    () => buildDimensionBreakdown(currentAttributed, (o) => o.source),
    [currentAttributed]
  );

  const directChannelSavings = useMemo(() => {
    const avoidedPlatformFee =
      currentSummary.netRevenue * ((salesTarget.estimatedAppCommissionPct || 25) / 100);
    const netSavingsAfterShipSubsidy = avoidedPlatformFee - currentSummary.totalShippingSubsidy;
    return {
      avoidedPlatformFee,
      netSavingsAfterShipSubsidy,
    };
  }, [
    currentSummary.netRevenue,
    currentSummary.totalShippingSubsidy,
    salesTarget.estimatedAppCommissionPct,
  ]);

  // 7. Granular SKU Performance Table
  const filteredSkuRows = useMemo(() => {
    const q = normalizeVietnamese(tableSearch);
    const list = allProductPerf.filter((r) => {
      if (filters.menuItemId !== 'Tất cả' && r.menuItemId !== filters.menuItemId) return false;
      if (!q) return true;
      return (
        normalizeVietnamese(r.name).includes(q) ||
        normalizeVietnamese(r.code).includes(q) ||
        normalizeVietnamese(r.category).includes(q)
      );
    });
    const mult = skuSort.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => (a[skuSort.key] - b[skuSort.key]) * mult);
  }, [allProductPerf, filters.menuItemId, tableSearch, skuSort]);

  const hasActiveSecondaryFilters =
    filters.source !== 'Tất cả' ||
    filters.zone !== 'Tất cả' ||
    filters.category !== 'Tất cả' ||
    filters.menuItemId !== 'Tất cả';

  const selectedDrillDish = useMemo(
    () =>
      filters.menuItemId !== 'Tất cả'
        ? menuItems.find((m) => m.id === filters.menuItemId) || null
        : null,
    [filters.menuItemId, menuItems]
  );

  // Target Input helpers synced to selected period (day / week / month)
  const periodFactor =
    salesTarget.period === 'day' ? 1 / 30 : salesTarget.period === 'week' ? 7 / 30 : 1;

  const displayedTargetProfit = Math.round(salesTarget.targetMonthlyProfit * periodFactor);
  const displayedTargetUnits = Math.max(1, Math.round(salesTarget.targetMonthlyUnits * periodFactor));

  const handleTargetProfitInput = (val: number) => {
    const safeVal = Math.max(0, val);
    const monthlyProfit = Math.round(safeVal / periodFactor);
    onUpdateSalesTarget({ mode: 'profit', targetMonthlyProfit: monthlyProfit });
  };

  const handleTargetUnitsInput = (val: number) => {
    const safeVal = Math.max(1, val);
    const monthlyUnits = Math.max(1, Math.round(safeVal / periodFactor));
    onUpdateSalesTarget({ mode: 'units', targetMonthlyUnits: monthlyUnits });
  };

  const handleExportActiveTable = () => {
    triggerDownloadCSV(
      `hieu_suat_mon_${dateWindow.start}_${dateWindow.end}.csv`,
      exportSkuPerformanceCSV(filteredSkuRows)
    );
  };

  const toggleSkuSort = (key: SkuSortKey) => {
    setSkuSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Heading & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Doanh thu bán hàng online &amp; Tự giao ship
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Phân tích xu hướng doanh thu, món bán chạy, tệp khách quay lại và kế hoạch sản lượng đạt mục tiêu lợi nhuận — tối ưu kênh bán trực tiếp 0% chiết khấu sàn.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportActiveTable}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Xuất CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setOrderModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Ghi nhận đơn bán</span>
          </button>
        </div>
      </div>

      {/* 1. GLOBAL FILTERS BAR */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Date Range Segmented Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filters.preset === p.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {filters.preset === 'custom' && (
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="date"
                  value={filters.customStart}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, customStart: e.target.value }))
                  }
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono-num text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  aria-label="Từ ngày"
                />
                <span className="text-slate-400">→</span>
                <input
                  type="date"
                  value={filters.customEnd}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, customEnd: e.target.value }))
                  }
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono-num text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  aria-label="Đến ngày"
                />
              </div>
            )}
          </div>

          {/* Period Date Meta */}
          <div className="text-xs text-slate-500 font-mono-num whitespace-nowrap">
            Kỳ xem: {dateWindow.start} → {dateWindow.end} ({dateWindow.daysCount} ngày)
          </div>
        </div>

        {/* Dimension Selectors: Direct Online Source, Delivery Zone, Category, Specific Dish */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2.5 border-t border-slate-100">
          <select
            value={filters.source}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                source: e.target.value as OrderSource | 'Tất cả',
              }))
            }
            aria-label="Lọc theo nguồn đơn online"
            className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="Tất cả">Nguồn đơn: Tất cả kênh tự tạo</option>
            {ORDER_SOURCES.map((s) => (
              <option key={s} value={s}>
                Nguồn: {s}
              </option>
            ))}
          </select>

          <select
            value={filters.zone}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                zone: e.target.value as DeliveryZone | 'Tất cả',
              }))
            }
            aria-label="Lọc theo khu vực giao ship"
            className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="Tất cả">Khu vực ship: Tất cả phạm vi</option>
            {DELIVERY_ZONES.map((z) => (
              <option key={z} value={z}>
                Khu vực: {z}
              </option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                category: e.target.value,
                menuItemId: 'Tất cả',
              }))
            }
            aria-label="Lọc theo danh mục món"
            className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'Tất cả' ? 'Danh mục: Tất cả nhóm món' : `Nhóm: ${c}`}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <select
              value={filters.menuItemId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, menuItemId: e.target.value }))
              }
              aria-label="Lọc theo từng món bán ra"
              className="flex-1 min-w-0 px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="Tất cả">Món bán ra: Tất cả món</option>
              {menuOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>

            {hasActiveSecondaryFilters && (
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    source: 'Tất cả',
                    zone: 'Tất cả',
                    category: 'Tất cả',
                    menuItemId: 'Tất cả',
                  }))
                }
                className="p-2 text-slate-500 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg shrink-0"
                title="Đặt lại bộ lọc"
                aria-label="Đặt lại bộ lọc"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Active Drill-down Indicator */}
        {selectedDrillDish && (
          <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
            <div className="text-slate-600">
              Đang xem chi tiết riêng món:{' '}
              <strong className="text-slate-900">
                {selectedDrillDish.code} · {selectedDrillDish.name}
              </strong>{' '}
              ({selectedDrillDish.category})
            </div>
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...prev, menuItemId: 'Tất cả' }))}
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 font-medium whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Xem toàn bộ món</span>
            </button>
          </div>
        )}
      </section>

      {/* 2. CORE KPI STRIP (5-Second Rule: Single Elevation, Hairline Dividers) */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {/* KPI 1: Net & Gross Revenue */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Doanh thu thuần (Net)</div>
          <div className="mt-1.5 font-mono-num text-2xl font-bold text-slate-900">
            {formatVND(currentSummary.netRevenue)}
          </div>
          <div className="mt-1.5">
            <DeltaIndicator deltaPct={kpiDeltas.netRevenue} suffix={dateWindow.comparisonLabel} />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono-num">
            Gross: {formatCompactVND(currentSummary.grossRevenue)} · Giảm:{' '}
            {formatCompactVND(currentSummary.totalDiscount)}
          </div>
        </div>

        {/* KPI 2: Gross Profit & Margin % */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Lợi nhuận gộp &amp; Biên</div>
          <div
            className={`mt-1.5 font-mono-num text-2xl font-bold ${
              currentSummary.grossProfit >= 0 ? 'text-slate-900' : 'text-red-600'
            }`}
          >
            {formatVND(currentSummary.grossProfit)}
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono-num font-semibold text-teal-700">
              Biên {formatPercent(currentSummary.grossMarginPct)}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <DeltaIndicator deltaPct={kpiDeltas.grossProfit} />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono-num">
            Giá vốn: {formatCompactVND(currentSummary.totalCogs)} · Bù ship:{' '}
            {formatCompactVND(currentSummary.totalShippingSubsidy)}
          </div>
        </div>

        {/* KPI 3: Total Orders & Units */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Tổng đơn hoàn tất</div>
          <div className="mt-1.5 font-mono-num text-2xl font-bold text-slate-900">
            {formatNumber(currentSummary.completedOrders, 0)}{' '}
            <span className="text-sm font-normal text-slate-500">đơn</span>
          </div>
          <div className="mt-1.5">
            <DeltaIndicator
              deltaPct={kpiDeltas.completedOrders}
              suffix={dateWindow.comparisonLabel}
            />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono-num">
            {formatNumber(currentSummary.totalUnits, 0)} phần/ly bán ra (TB{' '}
            {formatNumber(
              currentSummary.completedOrders > 0
                ? currentSummary.totalUnits / currentSummary.completedOrders
                : 0,
              1
            )}{' '}
            món/đơn)
          </div>
        </div>

        {/* KPI 4: Average Order Value (AOV) */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Giá trị đơn TB (AOV)</div>
          <div className="mt-1.5 font-mono-num text-2xl font-bold text-slate-900">
            {formatVND(currentSummary.aov)}
          </div>
          <div className="mt-1.5">
            <DeltaIndicator deltaPct={kpiDeltas.aov} suffix={dateWindow.comparisonLabel} />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono-num">
            Khách cũ: {formatCompactVND(currentSummary.returningAov)} · Mới:{' '}
            {formatCompactVND(currentSummary.newAov)}
          </div>
        </div>

        {/* KPI 5: Cancellation / Return Rate */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Tỷ lệ hoàn / hủy đơn</div>
          <div
            className={`mt-1.5 font-mono-num text-2xl font-bold ${
              currentSummary.cancellationRatePct > 6 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {formatPercent(currentSummary.cancellationRatePct)}
          </div>
          <div className="mt-1.5">
            <DeltaIndicator
              deltaPct={kpiDeltas.cancellationRate}
              invertColors
              suffix="điểm %"
            />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono-num">
            {currentSummary.cancelledOrders} đơn hủy · Thất thoát{' '}
            {formatCompactVND(currentSummary.cancelledValue)}
          </div>
        </div>
      </section>

      {/* 3. TREND COMBO CHART (8 cols) + PROFIT/VOLUME TARGET PLANNER (4 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left: Revenue Trend Combo Chart */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Xu hướng doanh thu so với kỳ trước
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhận diện nhịp tăng trưởng, ngày cao điểm và bất thường theo chu kỳ bán hàng
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowProfitLine((v) => !v)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  showProfitLine
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {showProfitLine ? 'Đang hiện lãi gộp' : '+ Đường lãi gộp'}
              </button>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'day', label: 'Ngày' },
                    { id: 'week', label: 'Tuần' },
                    { id: 'month', label: 'Tháng' },
                  ] as Array<{ id: TrendGranularity; label: string }>
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGranularity(g.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      granularity === g.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2.5 rounded-xs bg-teal-700 inline-block" />
              <span>Doanh thu kỳ này</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-slate-400 inline-block" />
              <span>Kỳ trước</span>
            </span>
            {showProfitLine && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-emerald-600 inline-block" />
                <span>Lợi nhuận gộp</span>
              </span>
            )}
          </div>

          <div className="mt-3 flex-1 min-h-[290px] w-full">
            {trendSeries.length === 0 ? (
              <div className="h-[290px] flex items-center justify-center text-sm text-slate-400">
                Chưa có dữ liệu đơn hàng trong khoảng thời gian này.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart
                  data={trendSeries}
                  margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    minTickGap={16}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCompactVND(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload as (typeof trendSeries)[number];
                      return (
                        <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-1.5 min-w-[200px]">
                          <div className="font-semibold text-slate-900 pb-1 border-b border-slate-100">
                            {label}
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">Doanh thu kỳ này</span>
                            <span className="font-mono-num font-semibold text-teal-800">
                              {formatVND(pt.currentRevenue)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">Kỳ trước</span>
                            <span className="font-mono-num text-slate-700">
                              {formatVND(pt.previousRevenue)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">Lợi nhuận gộp</span>
                            <span className="font-mono-num font-semibold text-emerald-700">
                              {formatVND(pt.grossProfit)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100 text-slate-500">
                            <span>Sản lượng</span>
                            <span className="font-mono-num">
                              {pt.orders} đơn · {pt.units} phần
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="currentRevenue"
                    name="Doanh thu kỳ này"
                    fill="#0f766e"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                  <Line
                    type="monotone"
                    dataKey="previousRevenue"
                    name="Kỳ trước"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  {showProfitLine && (
                    <Line
                      type="monotone"
                      dataKey="grossProfit"
                      name="Lợi nhuận gộp"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right: Profit Goal -> Required Daily / Weekly / Monthly Units & Bullet Progress */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Mục tiêu lợi nhuận &amp; Sản lượng
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tự tính số phần cần bán để đạt mức lãi đề xuất
                </p>
              </div>
              <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
                {(
                  [
                    { id: 'day', label: 'Ngày' },
                    { id: 'week', label: 'Tuần' },
                    { id: 'month', label: 'Tháng' },
                  ] as Array<{ id: SalesTargetPeriod; label: string }>
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onUpdateSalesTarget({ period: p.id })}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      salesTarget.period === p.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Switch: Target Net Profit vs Target Units */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'profit', label: 'Đặt theo lãi ròng' },
                  { id: 'units', label: 'Đặt theo số phần' },
                ] as Array<{ id: SalesTargetMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdateSalesTarget({ mode: m.id })}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    salesTarget.mode === m.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Interactive Goal Input */}
            {salesTarget.mode === 'profit' ? (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Lãi ròng mục tiêu /{' '}
                  {salesTarget.period === 'day'
                    ? 'ngày'
                    : salesTarget.period === 'week'
                      ? 'tuần'
                      : 'tháng'}{' '}
                  (sau chi phí cố định)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    step={salesTarget.period === 'day' ? 100000 : 1000000}
                    value={displayedTargetProfit}
                    onChange={(e) => handleTargetProfitInput(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 pr-12 text-right font-mono-num text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    VNĐ
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Sản lượng mục tiêu /{' '}
                  {salesTarget.period === 'day'
                    ? 'ngày'
                    : salesTarget.period === 'week'
                      ? 'tuần'
                      : 'tháng'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    step={salesTarget.period === 'day' ? 5 : 50}
                    value={displayedTargetUnits}
                    onChange={(e) => handleTargetUnitsInput(Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 pr-14 text-right font-mono-num text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    phần
                  </span>
                </div>
              </div>
            )}

            {/* Required Sales Pace Output */}
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="py-2 px-1 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] text-slate-500">Cần / ngày</div>
                <div className="font-mono-num text-base font-bold text-teal-800 mt-0.5">
                  {formatNumber(targetPlan.targetUnitsPerDay, 0)}
                </div>
              </div>
              <div className="py-2 px-1 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] text-slate-500">Cần / tuần</div>
                <div className="font-mono-num text-base font-bold text-slate-900 mt-0.5">
                  {formatNumber(targetPlan.targetUnitsPerWeek, 0)}
                </div>
              </div>
              <div className="py-2 px-1 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] text-slate-500">Cần / tháng</div>
                <div className="font-mono-num text-base font-bold text-slate-900 mt-0.5">
                  {formatNumber(targetPlan.targetUnitsPerMonth, 0)}
                </div>
              </div>
            </div>

            {/* Bullet Progress Bar (Actual vs Target with Break-even Marker) */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-700">
                  Tiến độ {targetPlan.periodLabel.toLowerCase()}
                </span>
                <span
                  className={`font-mono-num font-bold ${
                    targetPlan.unitsProgressPct >= 100
                      ? 'text-emerald-700'
                      : targetPlan.unitsProgressPct >= targetPlan.breakEvenMarkerPct
                        ? 'text-teal-700'
                        : 'text-slate-900'
                  }`}
                >
                  {formatPercent(targetPlan.unitsProgressPct)}
                </span>
              </div>

              <div className="relative h-3.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    targetPlan.unitsProgressPct >= 100 ? 'bg-emerald-600' : 'bg-teal-700'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, targetPlan.unitsProgressPct))}%` }}
                />
                {/* Break-even vertical tick */}
                {targetPlan.breakEvenMarkerPct > 0 && targetPlan.breakEvenMarkerPct < 100 && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-slate-900"
                    style={{ left: `${targetPlan.breakEvenMarkerPct}%` }}
                    title={`Điểm hòa vốn: ${targetPlan.breakEvenUnits} phần`}
                  />
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-num">
                <span>
                  Thực tế: {formatNumber(targetPlan.actualUnitsInPeriod, 0)} /{' '}
                  {formatNumber(targetPlan.targetUnitsForPeriod, 0)} phần
                </span>
                <span>Hòa vốn: {formatNumber(targetPlan.breakEvenUnits, 0)} phần</span>
              </div>
            </div>
          </div>

          {/* Bottom Economic Equations */}
          <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>Doanh thu mục tiêu kỳ này</span>
              <span className="font-mono-num font-semibold text-slate-900">
                {formatVND(targetPlan.targetRevenueForPeriod)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Lãi ròng dự kiến khi đạt KPI</span>
              <span
                className={`font-mono-num font-semibold ${
                  targetPlan.expectedNetProfitForPeriod >= 0 ? 'text-emerald-700' : 'text-red-600'
                }`}
              >
                {formatVND(targetPlan.expectedNetProfitForPeriod)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Lãi gộp TB / phần · CP cố định kỳ</span>
              <span className="font-mono-num">
                {formatCompactVND(targetPlan.avgContributionPerUnit)} ·{' '}
                {formatCompactVND(targetPlan.periodOverhead)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. BREAKDOWN ANALYTICS ROW (Product Ranking Drill-down + New vs Returning & Direct-Ship Economics) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left: Top Sellers & Slow Movers Horizontal Bar Chart (Clickable Drill-down) */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Xếp hạng sản phẩm bán ra
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhấp trực tiếp vào từng món để lọc sâu toàn bộ báo cáo theo món đó
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setProductRankMode('top')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  productRankMode === 'top'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Top bán chạy
              </button>
              <button
                type="button"
                onClick={() => setProductRankMode('slow')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  productRankMode === 'slow'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bán chậm / Tồn
              </button>
            </div>
          </div>

          <div className="mt-4 flex-1 min-h-[280px] w-full">
            {rankedProductsChart.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-slate-400">
                Chưa có sản phẩm phát sinh doanh số trong kỳ này.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={rankedProductsChart}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatCompactVND(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={158}
                    tick={{ fontSize: 11, fill: '#334155' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload as (typeof rankedProductsChart)[number];
                      return (
                        <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-1 min-w-[210px]">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="text-slate-500">
                            {item.code} · {item.category}
                          </div>
                          <div className="pt-1 border-t border-slate-100 flex justify-between">
                            <span className="text-slate-600">Doanh thu thuần</span>
                            <span className="font-mono-num font-semibold text-teal-800">
                              {formatVND(item.netRevenue)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Số lượng bán</span>
                            <span className="font-mono-num font-semibold text-slate-900">
                              {formatNumber(item.unitsSold, 0)} phần ({formatPercent(item.revenueSharePct)})
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Biên lợi nhuận gộp</span>
                            <span className="font-mono-num font-semibold text-emerald-700">
                              {formatPercent(item.marginPct)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="netRevenue"
                    radius={[0, 4, 4, 0]}
                    barSize={20}
                    className="cursor-pointer"
                    onClick={(data) => {
                      const clickedId = (data as { menuItemId?: string })?.menuItemId;
                      if (!clickedId) return;
                      setFilters((prev) => ({
                        ...prev,
                        menuItemId: prev.menuItemId === clickedId ? 'Tất cả' : clickedId,
                      }));
                    }}
                  >
                    {rankedProductsChart.map((entry) => {
                      const isSelected = filters.menuItemId === entry.menuItemId;
                      const fill = isSelected
                        ? '#115e59'
                        : productRankMode === 'slow'
                          ? '#94a3b8'
                          : '#0f766e';
                      return <Cell key={entry.menuItemId} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right: Customer Retention (New vs Returning) + Direct Online Shipping Efficiency */}
        <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Khách hàng Mới vs Quay lại &amp; Hiệu quả tự ship
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đo độ trung thành tệp khách online và mức tiết kiệm chiết khấu nền tảng
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 inline-block" />
                  <span>Quay lại ({formatPercent(currentSummary.returningRevenueSharePct, 0)})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
                  <span>Khách mới</span>
                </span>
              </div>
            </div>

            <div className="mt-4 h-[190px] w-full">
              {trendSeries.length === 0 ? (
                <div className="h-[190px] flex items-center justify-center text-sm text-slate-400">
                  Chưa có dữ liệu phân bổ khách hàng.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart
                    data={trendSeries}
                    margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1' }}
                      minTickGap={16}
                    />
                    <YAxis
                      tickFormatter={(v) => formatCompactVND(Number(v))}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload as (typeof trendSeries)[number];
                        const total = pt.returningRevenue + pt.newRevenue;
                        const retPct = total > 0 ? (pt.returningRevenue / total) * 100 : 0;
                        return (
                          <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
                            <div className="font-semibold text-slate-900">{label}</div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-600">Khách quay lại</span>
                              <span className="font-mono-num font-semibold text-teal-800">
                                {formatVND(pt.returningRevenue)} ({formatPercent(retPct, 0)})
                              </span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-slate-600">Khách mới</span>
                              <span className="font-mono-num text-slate-700">
                                {formatVND(pt.newRevenue)}
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="returningRevenue"
                      stackId="cust"
                      fill="#0f766e"
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="newRevenue"
                      stackId="cust"
                      fill="#cbd5e1"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Direct-Delivery & Zone Efficiency Summary (Unboxed hairline grid) */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Mật độ doanh thu theo khu vực ship
              </div>
              {zoneBreakdown.length === 0 ? (
                <div className="text-xs text-slate-400">Chưa có đơn giao trong kỳ.</div>
              ) : (
                <div className="space-y-1.5">
                  {zoneBreakdown.map((z) => (
                    <div key={z.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 truncate">{z.name}</span>
                        <span className="font-mono-num font-medium text-slate-900 whitespace-nowrap">
                          {formatCompactVND(z.revenue)} ({formatPercent(z.sharePct, 0)})
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-700 rounded-full"
                          style={{ width: `${Math.min(100, z.sharePct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 sm:pl-4 sm:border-l sm:border-slate-200">
              <div className="text-xs font-semibold text-slate-800">
                Lợi thế kênh bán online tự giao ship
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    Tiết kiệm phí sàn ({salesTarget.estimatedAppCommissionPct}%)
                  </span>
                  <span className="font-mono-num font-semibold text-emerald-700">
                    +{formatVND(directChannelSavings.avoidedPlatformFee)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Trừ chi phí quán bù ship</span>
                  <span className="font-mono-num text-slate-700">
                    -{formatVND(currentSummary.totalShippingSubsidy)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="font-medium text-slate-800">Ròng giữ lại được</span>
                  <span
                    className={`font-mono-num font-bold ${
                      directChannelSavings.netSavingsAfterShipSubsidy >= 0
                        ? 'text-emerald-700'
                        : 'text-red-600'
                    }`}
                  >
                    {formatVND(directChannelSavings.netSavingsAfterShipSubsidy)}
                  </span>
                </div>
                {sourceBreakdown[0] && (
                  <div className="text-[11px] text-slate-500 pt-1">
                    Nguồn hiệu quả nhất:{' '}
                    <strong className="text-slate-800">{sourceBreakdown[0].name}</strong> (
                    {formatPercent(sourceBreakdown[0].sharePct, 0)} DT)
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. GRANULAR DATA TABLE (SKU Performance) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Hiệu suất từng món ({filteredSkuRows.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhấp vào một dòng bất kỳ để lọc nhanh biểu đồ theo món đó
              </p>
            </div>
            {onOpenSalesHistory && (
              <button
                type="button"
                onClick={onOpenSalesHistory}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <span>Mở Lịch sử bán hàng ({salesOrders.length} đơn)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Tìm mã hoặc tên món..."
                className="w-full sm:w-72 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <button
              type="button"
              onClick={handleExportActiveTable}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Xuất bảng này</span>
            </button>
          </div>
        </div>

        {filteredSkuRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Không tìm thấy dữ liệu món phù hợp với bộ lọc hiện tại.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">Mã / Tên món</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSkuSort('unitsSold')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>SL bán</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSkuSort('netRevenue')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Doanh thu thuần</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá vốn (COGS)</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSkuSort('grossProfit')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Lợi nhuận gộp</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSkuSort('marginPct')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Biên LN</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSkuSort('revenueSharePct')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Tỷ trọng DT</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredSkuRows.map((row) => {
                  const isDrilled = filters.menuItemId === row.menuItemId;
                  return (
                    <tr
                      key={row.menuItemId}
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          menuItemId: prev.menuItemId === row.menuItemId ? 'Tất cả' : row.menuItemId,
                        }))
                      }
                      className={`cursor-pointer transition-colors ${
                        isDrilled ? 'bg-teal-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-500">
                          {row.code} · {row.category}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-900 whitespace-nowrap">
                        {formatNumber(row.unitsSold, 0)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                        {formatVND(row.netRevenue, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-600 whitespace-nowrap">
                        {formatVND(row.cogs, false)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                          row.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatVND(row.grossProfit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatPercent(row.marginPct)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-600 whitespace-nowrap">
                        {formatPercent(row.revenueSharePct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SalesOrderModal
        open={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        menuItems={menuItems}
        catalogMap={catalogMap}
        existingOrders={salesOrders}
        onCreateOrder={onAddSalesOrder}
      />
    </div>
  );
}
