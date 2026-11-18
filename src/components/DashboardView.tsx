import React, { useMemo, useState } from 'react';
import { ArrowRight, Download, Search } from 'lucide-react';
import { CatalogItem, FixedCostItem, MenuItem, OverheadConfig } from '../types/costing';
import {
  computeMenuItemCosting,
  exportMenuCostToCSV,
  formatPercent,
  formatVND,
  normalizeVietnamese,
  triggerDownloadCSV,
} from '../utils/formatters';

interface DashboardViewProps {
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  fixedCosts: FixedCostItem[];
  overheadConfig: OverheadConfig;
  overheadSummary: {
    fixedCostsSum: number;
    ccdcDepreciationSum: number;
    totalMonthlyOverhead: number;
    overheadPerUnit: number;
  };
  onOpenRecipe: (menuId: string) => void;
  onNavigateTab: (tab: 'recipes' | 'catalog' | 'fixed-costs' | 'menu-board') => void;
}

export function DashboardView({
  menuItems,
  catalogMap,
  fixedCosts,
  overheadConfig,
  overheadSummary,
  onOpenRecipe,
  onNavigateTab,
}: DashboardViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Tất cả');
  const [simTargetFoodCost, setSimTargetFoodCost] = useState<number>(
    overheadConfig.defaultTargetFoodCostPct || 30
  );

  const categories = useMemo(() => {
    const set = new Set(menuItems.map((m) => m.category));
    return ['Tất cả', ...Array.from(set)];
  }, [menuItems]);

  const enrichedItems = useMemo(() => {
    return menuItems.map((item) => ({
      item,
      costing: computeMenuItemCosting(item, catalogMap, overheadSummary.overheadPerUnit),
    }));
  }, [menuItems, catalogMap, overheadSummary.overheadPerUnit]);

  const filteredItems = useMemo(() => {
    const q = normalizeVietnamese(search);
    return enrichedItems.filter(({ item }) => {
      if (categoryFilter !== 'Tất cả' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        normalizeVietnamese(item.name).includes(q) ||
        normalizeVietnamese(item.code).includes(q) ||
        normalizeVietnamese(item.category).includes(q)
      );
    });
  }, [enrichedItems, search, categoryFilter]);

  const summaryKPIs = useMemo(() => {
    const activeMenu = enrichedItems.filter((e) => e.item.isOnMenu);
    const totalProjectedRevenue = activeMenu.reduce(
      (sum, e) => sum + e.item.sellingPrice * (e.item.estimatedMonthlySales || 0),
      0
    );
    const totalProjectedCogs = activeMenu.reduce(
      (sum, e) => sum + e.costing.cogsPerUnit * (e.item.estimatedMonthlySales || 0),
      0
    );
    const totalProjectedPlatformFee = activeMenu.reduce(
      (sum, e) => sum + e.costing.platformFeePerUnit * (e.item.estimatedMonthlySales || 0),
      0
    );
    const avgFoodCostPct =
      totalProjectedRevenue > 0
        ? (totalProjectedCogs / totalProjectedRevenue) * 100
        : activeMenu.length > 0
          ? activeMenu.reduce((s, e) => s + e.costing.foodCostPct, 0) / activeMenu.length
          : 0;

    const monthlyGrossProfit = totalProjectedRevenue - totalProjectedCogs - totalProjectedPlatformFee;
    const monthlyNetProfit = monthlyGrossProfit - overheadSummary.totalMonthlyOverhead;

    const avgContributionMargin =
      activeMenu.length > 0
        ? activeMenu.reduce((s, e) => s + (e.item.sellingPrice - e.costing.cogsPerUnit - e.costing.platformFeePerUnit), 0) /
          activeMenu.length
        : 0;
    const breakEvenUnits =
      avgContributionMargin > 0
        ? Math.ceil(overheadSummary.totalMonthlyOverhead / avgContributionMargin)
        : 0;

    return {
      activeCount: activeMenu.length,
      totalCount: menuItems.length,
      avgFoodCostPct,
      totalProjectedRevenue,
      monthlyGrossProfit,
      monthlyNetProfit,
      breakEvenUnits,
    };
  }, [enrichedItems, menuItems.length, overheadSummary.totalMonthlyOverhead]);

  const handleExportReport = () => {
    const csv = exportMenuCostToCSV(menuItems, catalogMap, overheadSummary.overheadPerUnit);
    triggerDownloadCSV('bao_cao_gia_thanh_menu.csv', csv);
  };

  return (
    <div className="space-y-8">
      {/* Page Title & Action */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Tổng quan giá thành &amp; biên lợi nhuận
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tra cứu nhanh giá vốn trực tiếp, phân bổ chi phí cố định mặt bằng và sức khỏe lợi nhuận từng món trên menu.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportReport}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4 text-slate-500" />
          <span>Xuất bảng giá thành CSV</span>
        </button>
      </div>

      {/* 4-Column Unified KPI Strip (Single elevation, clean dividers) */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Món đang kinh doanh</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {summaryKPIs.activeCount} / {summaryKPIs.totalCount}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            {catalogMap.size} mã hàng trong kho định lượng
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Tỉ lệ Food Cost bình quân</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {formatPercent(summaryKPIs.avgFoodCostPct)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Mục tiêu chuẩn F&amp;B: ≤ {overheadConfig.defaultTargetFoodCostPct}%
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Chi phí cố định &amp; mặt bằng</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {formatVND(overheadSummary.totalMonthlyOverhead)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Phân bổ {formatVND(overheadSummary.overheadPerUnit)} / sản phẩm
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Lãi ròng dự kiến / tháng</div>
          <div
            className={`mt-2 font-mono-num text-2xl font-semibold ${
              summaryKPIs.monthlyNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {formatVND(summaryKPIs.monthlyNetProfit)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Điểm hòa vốn: {summaryKPIs.breakEvenUnits} phần / tháng
          </div>
        </div>
      </section>

      {/* Main Lookup & Pricing Comparison Grid */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === cat
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <span className="whitespace-nowrap">Food Cost giả lập:</span>
              <input
                type="number"
                min={10}
                max={80}
                value={simTargetFoodCost}
                onChange={(e) => setSimTargetFoodCost(Number(e.target.value) || 30)}
                className="w-12 font-mono-num font-semibold text-slate-900 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-right"
              />
              <span>%</span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên món hoặc mã..."
                className="w-full sm:w-64 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900">Không tìm thấy món phù hợp</p>
            <p className="text-xs text-slate-500 mt-1">
              Thử từ khóa khác hoặc tạo món mới trong phần Định lượng &amp; Tính giá.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">Mã / Tên món</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">NVL</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Bao bì</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá vốn (COGS)</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">CP cố định</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Tổng giá thành</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá gợi ý ({simTargetFoodCost}%)</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá bán</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Lãi ròng</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">% Cost</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Đánh giá</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredItems.map(({ item, costing }) => {
                  const suggested = costing.suggestedPriceByFoodCost(simTargetFoodCost);
                  const statusTone =
                    costing.healthStatus === 'optimal'
                      ? 'text-emerald-700'
                      : costing.healthStatus === 'warning'
                        ? 'text-amber-700'
                        : 'text-red-600';

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onOpenRecipe(item.id)}
                      className="hover:bg-slate-50/90 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{item.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <span className="font-mono-num">{item.code}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.category}</span>
                          {item.sizeLabel && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.sizeLabel}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatVND(costing.ingredientsCostPerUnit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatVND(costing.packagingCostPerUnit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-medium text-slate-900 whitespace-nowrap">
                        {formatVND(costing.cogsPerUnit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-600 whitespace-nowrap">
                        {formatVND(costing.overheadPerUnit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                        {formatVND(costing.totalUnitCost, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-teal-700 whitespace-nowrap">
                        {formatVND(suggested, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                        {formatVND(item.sellingPrice, false)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                          costing.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatVND(costing.netProfit, false)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatPercent(costing.foodCostPct)}
                      </td>
                      <td className={`py-3 px-4 text-right text-xs font-semibold whitespace-nowrap ${statusTone}`}>
                        {costing.healthLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bottom Operational Summary Row */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Cấu trúc chi phí cố định &amp; mặt bằng tháng
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Đang bật {fixedCosts.filter((c) => c.active).length} khoản chi cố định và{' '}
              {overheadConfig.includeCcdcDepreciation ? 'có' : 'không'} tính khấu hao CCDC.
            </p>

            <div className="mt-4 divide-y divide-slate-100 text-sm">
              {fixedCosts.slice(0, 4).map((fc) => (
                <div key={fc.id} className="py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className={`truncate ${fc.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                      {fc.name}
                    </div>
                    <div className="text-xs text-slate-400">{fc.category}</div>
                  </div>
                  <div className="font-mono-num font-medium text-slate-900 whitespace-nowrap">
                    {formatVND(fc.monthlyAmount)}
                  </div>
                </div>
              ))}
              {overheadConfig.includeCcdcDepreciation && (
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-slate-800">Khấu hao Công cụ dụng cụ (CCDC)</div>
                    <div className="text-xs text-slate-400">Tính tự động từ bảng hàng hóa</div>
                  </div>
                  <div className="font-mono-num font-medium text-slate-900 whitespace-nowrap">
                    {formatVND(overheadSummary.ccdcDepreciationSum)}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Sản lượng dự kiến: <strong className="font-mono-num text-slate-800">{overheadConfig.projectedMonthlyUnits}</strong> phần/tháng
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('fixed-costs')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap"
            >
              <span>Điều chỉnh chi phí</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Dự phóng doanh thu &amp; lợi nhuận tháng
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Tổng hợp theo sản lượng bán dự kiến của các món đang hiển thị trên menu.
            </p>

            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Doanh thu dự kiến / tháng</span>
                <span className="font-mono-num font-semibold text-slate-900">
                  {formatVND(summaryKPIs.totalProjectedRevenue)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Lợi nhuận gộp (sau NVL &amp; Bao bì)</span>
                <span className="font-mono-num font-semibold text-slate-900">
                  {formatVND(summaryKPIs.monthlyGrossProfit)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Trừ Tổng chi phí cố định &amp; mặt bằng</span>
                <span className="font-mono-num font-medium text-red-600">
                  -{formatVND(overheadSummary.totalMonthlyOverhead)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="font-semibold text-slate-900">Lợi nhuận ròng ước tính</span>
                <span
                  className={`font-mono-num text-lg font-bold ${
                    summaryKPIs.monthlyNetProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {formatVND(summaryKPIs.monthlyNetProfit)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onNavigateTab('catalog')}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
            >
              Tra cứu bảng nguyên vật liệu
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('menu-board')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap"
            >
              <span>Mở trang quản lý Menu</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
