import React, { useMemo, useState } from 'react';
import { Download, Eye, EyeOff, Plus, Printer, Search, SlidersHorizontal } from 'lucide-react';
import { CatalogItem, MenuItem } from '../types/costing';
import {
  computeMenuItemCosting,
  exportMenuCostToCSV,
  formatPercent,
  formatVND,
  normalizeVietnamese,
  triggerDownloadCSV,
} from '../utils/formatters';

interface MenuBoardViewProps {
  menuItems: MenuItem[];
  catalogMap: Map<string, CatalogItem>;
  overheadPerUnit: number;
  onUpdateMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  onOpenRecipe: (id: string) => void;
  onCreateNewDish: () => void;
}

export function MenuBoardView({
  menuItems,
  catalogMap,
  overheadPerUnit,
  onUpdateMenuItem,
  onOpenRecipe,
  onCreateNewDish,
}: MenuBoardViewProps) {
  const [viewMode, setViewMode] = useState<'manage' | 'customer'>('manage');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Tất cả');

  const categories = useMemo(() => {
    const set = new Set(menuItems.map((m) => m.category));
    return ['Tất cả', ...Array.from(set)];
  }, [menuItems]);

  const filtered = useMemo(() => {
    const q = normalizeVietnamese(search);
    return menuItems.filter((m) => {
      if (viewMode === 'customer' && !m.isOnMenu) return false;
      if (categoryFilter !== 'Tất cả' && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        normalizeVietnamese(m.name).includes(q) ||
        normalizeVietnamese(m.code).includes(q) ||
        normalizeVietnamese(m.description).includes(q)
      );
    });
  }, [menuItems, viewMode, categoryFilter, search]);

  const groupedForCustomer = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Quản lý trang Menu món
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Điều chỉnh nhanh giá bán, mô tả món, trạng thái hiển thị hoặc chuyển sang bản xem Menu khách hàng để in ấn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('manage')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'manage'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chế độ Quản lý
            </button>
            <button
              type="button"
              onClick={() => setViewMode('customer')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'customer'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Trang Menu Khách hàng
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              triggerDownloadCSV(
                'menu_gia_ban.csv',
                exportMenuCostToCSV(menuItems, catalogMap, overheadPerUnit)
              )
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Xuất CSV</span>
          </button>

          {viewMode === 'customer' && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>In thực đơn</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm món trong menu..."
            className="w-full sm:w-72 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>

      {viewMode === 'manage' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-900">Không tìm thấy món trong menu</p>
              <button
                type="button"
                onClick={onCreateNewDish}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm món mới</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 whitespace-nowrap">Hiển thị</th>
                    <th className="py-3 px-3 whitespace-nowrap">Tên món &amp; Mô tả</th>
                    <th className="py-3 px-3 whitespace-nowrap">Nhóm / Size</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Giá thành</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Giá bán Menu (đ)</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">% Cost</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Lãi ròng</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Định lượng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filtered.map((item) => {
                    const costing = computeMenuItemCosting(item, catalogMap, overheadPerUnit);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateMenuItem(item.id, { isOnMenu: !item.isOnMenu })
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                              item.isOnMenu
                                ? 'bg-teal-50 border-teal-200 text-teal-800'
                                : 'bg-slate-100 border-slate-200 text-slate-500'
                            }`}
                          >
                            {item.isOnMenu ? (
                              <>
                                <Eye className="w-3.5 h-3.5" />
                                <span>Đang bán</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-3.5 h-3.5" />
                                <span>Đang ẩn</span>
                              </>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3 min-w-[260px]">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) =>
                              onUpdateMenuItem(item.id, { name: e.target.value })
                            }
                            className="w-full font-medium text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-teal-600 rounded px-2 py-0.5 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) =>
                              onUpdateMenuItem(item.id, { description: e.target.value })
                            }
                            placeholder="Thêm mô tả cho khách hàng..."
                            className="w-full text-xs text-slate-500 bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-teal-600 rounded px-2 py-0.5 mt-0.5 focus:outline-none"
                          />
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap text-xs text-slate-600">
                          <div>{item.category}</div>
                          <div className="text-slate-400">
                            {item.code} · {item.sizeLabel || 'Tiêu chuẩn'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                          {formatVND(costing.totalUnitCost, false)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={item.sellingPrice}
                            onChange={(e) =>
                              onUpdateMenuItem(item.id, {
                                sellingPrice: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-28 px-2.5 py-1 text-right font-mono-num font-semibold text-slate-900 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                          {formatPercent(costing.foodCostPct)}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono-num font-semibold whitespace-nowrap ${
                            costing.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {formatVND(costing.netProfit, false)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onOpenRecipe(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg whitespace-nowrap"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            <span>Sửa công thức</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Customer-Ready Menu Board */
        <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 max-w-4xl mx-auto">
          <div className="text-center pb-8 border-b border-slate-200">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
              Thực Đơn Cửa Hàng
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Giá niêm yết đã bao gồm đóng gói tiêu chuẩn · Cập nhật đồng bộ theo bảng định lượng
            </p>
          </div>

          {groupedForCustomer.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Chưa có món nào được bật hiển thị trên Menu.
            </div>
          ) : (
            <div className="mt-8 space-y-10">
              {groupedForCustomer.map(([categoryName, items]) => (
                <section key={categoryName}>
                  <h3 className="font-display text-lg font-bold text-slate-900 pb-3 border-b border-slate-200">
                    {categoryName}
                  </h3>
                  <div className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const costing = computeMenuItemCosting(
                        item,
                        catalogMap,
                        overheadPerUnit
                      );
                      return (
                        <div
                          key={item.id}
                          className="py-4 flex items-start justify-between gap-6"
                        >
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="font-semibold text-base text-slate-900">
                                {item.name}
                              </span>
                              {item.sizeLabel && (
                                <span className="text-xs text-slate-500">
                                  ({item.sizeLabel})
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                                {item.description}
                              </p>
                            )}
                            {costing.totalCaloriesPerUnit > 0 && (
                              <div className="text-xs text-slate-400 mt-1 font-mono-num">
                                ~{Math.round(costing.totalCaloriesPerUnit)} kcal
                              </div>
                            )}
                          </div>
                          <div className="font-mono-num text-base font-bold text-slate-900 whitespace-nowrap shrink-0">
                            {formatVND(item.sellingPrice)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
