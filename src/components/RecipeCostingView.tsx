import React, { useMemo, useState } from 'react';
import { Copy, Plus, Search, Trash2 } from 'lucide-react';
import {
  CatalogItem,
  MenuItem,
  OverheadAllocationMode,
  OverheadConfig,
} from '../types/costing';
import {
  computeCatalogUnitStats,
  computeMenuItemCosting,
  formatNumber,
  formatPercent,
  formatVND,
  normalizeVietnamese,
} from '../utils/formatters';

interface RecipeCostingViewProps {
  menuItems: MenuItem[];
  selectedMenuId: string | null;
  onSelectMenuId: (id: string) => void;
  catalog: CatalogItem[];
  catalogMap: Map<string, CatalogItem>;
  overheadSummary: {
    fixedCostsSum: number;
    ccdcDepreciationSum: number;
    totalMonthlyOverhead: number;
    overheadPerUnit: number;
  };
  overheadConfig: OverheadConfig;
  onAddMenuItem: () => void;
  onUpdateMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  onDuplicateMenuItem: (id: string) => void;
  onDeleteMenuItem: (id: string) => void;
}

export function RecipeCostingView({
  menuItems,
  selectedMenuId,
  onSelectMenuId,
  catalog,
  catalogMap,
  overheadSummary,
  overheadConfig,
  onAddMenuItem,
  onUpdateMenuItem,
  onDuplicateMenuItem,
  onDeleteMenuItem,
}: RecipeCostingViewProps) {
  const [menuSearch, setMenuSearch] = useState('');
  const [ingSearch, setIngSearch] = useState('');
  const [pkgSearch, setPkgSearch] = useState('');
  const [targetFoodCostPct, setTargetFoodCostPct] = useState<number>(
    overheadConfig.defaultTargetFoodCostPct || 30
  );
  const [confirmDeleteMenu, setConfirmDeleteMenu] = useState(false);

  const selectedMenu = useMemo(() => {
    return menuItems.find((m) => m.id === selectedMenuId) || menuItems[0] || null;
  }, [menuItems, selectedMenuId]);

  const filteredMenuList = useMemo(() => {
    const q = normalizeVietnamese(menuSearch);
    if (!q) return menuItems;
    return menuItems.filter(
      (m) =>
        normalizeVietnamese(m.name).includes(q) ||
        normalizeVietnamese(m.code).includes(q) ||
        normalizeVietnamese(m.category).includes(q)
    );
  }, [menuItems, menuSearch]);

  const availableIngredients = useMemo(() => {
    const q = normalizeVietnamese(ingSearch);
    return catalog
      .filter((c) => c.category === 'Nguyên vật liệu')
      .filter(
        (c) =>
          !q ||
          normalizeVietnamese(c.name).includes(q) ||
          normalizeVietnamese(c.code).includes(q)
      );
  }, [catalog, ingSearch]);

  const availablePackaging = useMemo(() => {
    const q = normalizeVietnamese(pkgSearch);
    return catalog
      .filter((c) => c.category === 'Bao bì')
      .filter(
        (c) =>
          !q ||
          normalizeVietnamese(c.name).includes(q) ||
          normalizeVietnamese(c.code).includes(q)
      );
  }, [catalog, pkgSearch]);

  const costing = useMemo(() => {
    if (!selectedMenu) return null;
    return computeMenuItemCosting(selectedMenu, catalogMap, overheadSummary.overheadPerUnit);
  }, [selectedMenu, catalogMap, overheadSummary.overheadPerUnit]);

  const handleAddIngredientLine = (catalogItemId: string) => {
    if (!selectedMenu || !catalogItemId) return;
    const existing = selectedMenu.ingredients.find((l) => l.catalogItemId === catalogItemId);
    if (existing) {
      onUpdateMenuItem(selectedMenu.id, {
        ingredients: selectedMenu.ingredients.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l
        ),
      });
    } else {
      onUpdateMenuItem(selectedMenu.id, {
        ingredients: [
          ...selectedMenu.ingredients,
          {
            id: `ing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            catalogItemId,
            quantity: 10,
          },
        ],
      });
    }
    setIngSearch('');
  };

  const handleAddPackagingLine = (catalogItemId: string) => {
    if (!selectedMenu || !catalogItemId) return;
    const existing = selectedMenu.packaging.find((l) => l.catalogItemId === catalogItemId);
    if (existing) {
      onUpdateMenuItem(selectedMenu.id, {
        packaging: selectedMenu.packaging.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l
        ),
      });
    } else {
      onUpdateMenuItem(selectedMenu.id, {
        packaging: [
          ...selectedMenu.packaging,
          {
            id: `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            catalogItemId,
            quantity: 1,
          },
        ],
      });
    }
    setPkgSearch('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Định lượng công thức &amp; tính giá bán
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Chọn món bên trái để nhập định lượng nguyên liệu, bao bì, phân bổ chi phí cố định và tối ưu giá bán.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Menu Selector List */}
        <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Danh sách món ({menuItems.length})
              </h2>
              <button
                type="button"
                onClick={onAddMenuItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-700 hover:bg-teal-800 text-white rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm món</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Tìm món theo tên, mã..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
            {filteredMenuList.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Không có món nào khớp với từ khóa tìm kiếm.
              </div>
            ) : (
              filteredMenuList.map((m) => {
                const c = computeMenuItemCosting(m, catalogMap, overheadSummary.overheadPerUnit);
                const isSelected = selectedMenu?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onSelectMenuId(m.id);
                      setConfirmDeleteMenu(false);
                    }}
                    className={`w-full text-left p-4 transition-colors ${
                      isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-900 truncate">
                          {m.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <span className="font-mono-num">{m.code}</span>
                          <span aria-hidden="true">·</span>
                          <span>{m.sizeLabel || m.category}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono-num text-sm font-semibold text-slate-900">
                          {formatVND(m.sellingPrice, false)}
                        </div>
                        <div
                          className={`font-mono-num text-xs ${
                            c.healthStatus === 'optimal'
                              ? 'text-emerald-700'
                              : c.healthStatus === 'warning'
                                ? 'text-amber-700'
                                : 'text-red-600'
                          }`}
                        >
                          Cost {formatPercent(c.foodCostPct)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Column: Active Recipe & Price Breakdown */}
        {!selectedMenu || !costing ? (
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-base font-medium text-slate-900">Chưa có món nào được chọn</p>
            <p className="text-sm text-slate-500 mt-1">
              Tạo món mới để bắt đầu nhập định lượng nguyên vật liệu và bao bì.
            </p>
            <button
              type="button"
              onClick={onAddMenuItem}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo món đầu tiên</span>
            </button>
          </div>
        ) : (
          <div className="xl:col-span-8 space-y-6">
            {/* Dish Metadata Editor */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="font-mono-num text-xs font-semibold text-teal-800 bg-teal-50 px-2.5 py-1 rounded">
                    {selectedMenu.code}
                  </span>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {selectedMenu.name}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onDuplicateMenuItem(selectedMenu.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Nhân bản</span>
                  </button>

                  {!confirmDeleteMenu ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteMenu(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-slate-200 hover:bg-red-50 rounded-lg whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa món</span>
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteMenuItem(selectedMenu.id);
                          setConfirmDeleteMenu(false);
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Xác nhận xóa
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMenu(false)}
                        className="px-2.5 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                      >
                        Hủy
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Tên món
                  </label>
                  <input
                    type="text"
                    value={selectedMenu.name}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, { name: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Mã món
                  </label>
                  <input
                    type="text"
                    value={selectedMenu.code}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, { code: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Size / Quy cách
                  </label>
                  <input
                    type="text"
                    value={selectedMenu.sizeLabel}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, { sizeLabel: e.target.value })
                    }
                    placeholder="500ml / Hộp"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nhóm Menu
                  </label>
                  <input
                    type="text"
                    value={selectedMenu.category}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, { category: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Số phần / mẻ (Yield)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={selectedMenu.yieldCount}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, {
                        yieldCount: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Sản lượng dự kiến / tháng
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={selectedMenu.estimatedMonthlySales}
                    onChange={(e) =>
                      onUpdateMenuItem(selectedMenu.id, {
                        estimatedMonthlySales: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div className="flex items-end">
                  <label className="w-full flex items-center justify-between px-3 py-2 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-700">Hiển thị Menu</span>
                    <input
                      type="checkbox"
                      checked={selectedMenu.isOnMenu}
                      onChange={(e) =>
                        onUpdateMenuItem(selectedMenu.id, { isOnMenu: e.target.checked })
                      }
                      className="w-4 h-4 accent-teal-700"
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* Section A: Nguyên vật liệu BOM */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    1. Định lượng Nguyên vật liệu (NVL)
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedMenu.yieldCount > 1
                      ? `Định lượng cho mẻ ${selectedMenu.yieldCount} phần · Chi phí NVL mỗi phần = ${formatVND(costing.ingredientsCostPerUnit)}`
                      : `Định lượng cho 1 phần · Tổng NVL = ${formatVND(costing.ingredientsCostPerUnit)}`}
                  </p>
                </div>

                {/* Searchable Add Ingredient Picker */}
                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    value={ingSearch}
                    onChange={(e) => setIngSearch(e.target.value)}
                    placeholder="+ Thêm nguyên liệu (tìm mã hoặc tên)..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  {ingSearch.trim() !== '' && (
                    <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto z-20 divide-y divide-slate-100">
                      {availableIngredients.length === 0 ? (
                        <div className="p-3 text-xs text-slate-500">
                          Không tìm thấy nguyên liệu phù hợp
                        </div>
                      ) : (
                        availableIngredients.slice(0, 12).map((cat) => {
                          const st = computeCatalogUnitStats(cat);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleAddIngredientLine(cat.id)}
                              className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900 truncate">
                                  {cat.name}
                                </div>
                                <div className="text-slate-400 font-mono-num">{cat.code}</div>
                              </div>
                              <div className="font-mono-num text-teal-700 font-medium shrink-0">
                                {formatVND(st.unitPrice, false)}/{cat.dvtLe}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedMenu.ingredients.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Chưa có nguyên liệu nào. Gõ tên hoặc mã (ví dụ: Matcha, Sữa đặc, Đường...) ở ô phía trên để thêm vào định lượng.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Mã / Nguyên liệu</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đơn giá lẻ</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Định lượng</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Thành tiền</th>
                        <th className="py-2.5 px-4 text-right w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedMenu.ingredients.map((line) => {
                        const cat = catalogMap.get(line.catalogItemId);
                        if (!cat) return null;
                        const stats = computeCatalogUnitStats(cat);
                        const lineCost = stats.unitPrice * (line.quantity || 0);
                        return (
                          <tr key={line.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{cat.name}</div>
                              <div className="text-xs text-slate-400 font-mono-num">
                                {cat.code} · {cat.dvtLe}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-slate-600 whitespace-nowrap">
                              {formatVND(stats.unitPrice, false)}/{cat.dvtLe}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={line.quantity}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    onUpdateMenuItem(selectedMenu.id, {
                                      ingredients: selectedMenu.ingredients.map((l) =>
                                        l.id === line.id ? { ...l, quantity: val } : l
                                      ),
                                    });
                                  }}
                                  className="w-20 px-2 py-1 text-right font-mono-num text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                                />
                                <span className="text-xs text-slate-500 w-9 text-left">
                                  {cat.dvtLe}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num font-medium text-slate-900 whitespace-nowrap">
                              {formatVND(lineCost, false)} đ
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateMenuItem(selectedMenu.id, {
                                    ingredients: selectedMenu.ingredients.filter(
                                      (l) => l.id !== line.id
                                    ),
                                  })
                                }
                                className="p-1 text-slate-400 hover:text-red-600 rounded"
                                title="Xóa dòng"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Section B: Bao bì BOM */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    2. Bao bì &amp; Đóng gói (trên 1 phần bán)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tổng chi phí bao bì = <strong className="font-mono-num text-slate-800">{formatVND(costing.packagingCostPerUnit)}</strong> / phần
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    value={pkgSearch}
                    onChange={(e) => setPkgSearch(e.target.value)}
                    placeholder="+ Thêm ly, nắp, ống hút, túi..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  {pkgSearch.trim() !== '' && (
                    <div className="absolute right-0 left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto z-20 divide-y divide-slate-100">
                      {availablePackaging.length === 0 ? (
                        <div className="p-3 text-xs text-slate-500">
                          Không tìm thấy bao bì phù hợp
                        </div>
                      ) : (
                        availablePackaging.slice(0, 12).map((cat) => {
                          const st = computeCatalogUnitStats(cat);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleAddPackagingLine(cat.id)}
                              className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-900 truncate">
                                  {cat.name}
                                </div>
                                <div className="text-slate-400 font-mono-num">{cat.code}</div>
                              </div>
                              <div className="font-mono-num text-teal-700 font-medium shrink-0">
                                {formatVND(st.unitPrice, false)}/{cat.dvtLe}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedMenu.packaging.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Chưa chọn bao bì. Gõ tên hoặc mã bao bì (ví dụ: Ly nhựa, Nắp, Ống hút...) ở ô trên để thêm.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Mã / Bao bì</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đơn giá</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Số lượng</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Thành tiền</th>
                        <th className="py-2.5 px-4 text-right w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedMenu.packaging.map((line) => {
                        const cat = catalogMap.get(line.catalogItemId);
                        if (!cat) return null;
                        const stats = computeCatalogUnitStats(cat);
                        const lineCost = stats.unitPrice * (line.quantity || 0);
                        return (
                          <tr key={line.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{cat.name}</div>
                              <div className="text-xs text-slate-400 font-mono-num">
                                {cat.code} · {cat.dvtLe}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num text-slate-600 whitespace-nowrap">
                              {formatVND(stats.unitPrice, false)}/{cat.dvtLe}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={line.quantity}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    onUpdateMenuItem(selectedMenu.id, {
                                      packaging: selectedMenu.packaging.map((l) =>
                                        l.id === line.id ? { ...l, quantity: val } : l
                                      ),
                                    });
                                  }}
                                  className="w-20 px-2 py-1 text-right font-mono-num text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                                />
                                <span className="text-xs text-slate-500 w-9 text-left">
                                  {cat.dvtLe}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-num font-medium text-slate-900 whitespace-nowrap">
                              {formatVND(lineCost, false)} đ
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateMenuItem(selectedMenu.id, {
                                    packaging: selectedMenu.packaging.filter(
                                      (l) => l.id !== line.id
                                    ),
                                  })
                                }
                                className="p-1 text-slate-400 hover:text-red-600 rounded"
                                title="Xóa dòng"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Section C & D: Overhead Allocation + Cost Summary & Pricing Calculator */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-6">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  3. Chi phí cố định, Mặt bằng &amp; Tính giá bán
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tổng hợp đầy đủ chi phí cấu thành giá thành sản phẩm và đề xuất giá bán theo tỉ lệ Food Cost mục tiêu.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: Cost Breakdown + Overhead Settings */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Phân bổ CP cố định &amp; mặt bằng
                      </label>
                      <select
                        value={selectedMenu.overheadMode}
                        onChange={(e) =>
                          onUpdateMenuItem(selectedMenu.id, {
                            overheadMode: e.target.value as OverheadAllocationMode,
                          })
                        }
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="auto">
                          Tự động ({formatVND(overheadSummary.overheadPerUnit, false)} đ/phần)
                        </option>
                        <option value="custom">Nhập tay cho món này</option>
                        <option value="none">Không phân bổ (0 đ)</option>
                      </select>
                    </div>

                    {selectedMenu.overheadMode === 'custom' ? (
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          CP cố định riêng (đ/phần)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={selectedMenu.customOverheadPerUnit}
                          onChange={(e) =>
                            onUpdateMenuItem(selectedMenu.id, {
                              customOverheadPerUnit: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Chiết khấu App / Sàn (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          step="0.5"
                          value={selectedMenu.platformFeePct}
                          onChange={(e) =>
                            onUpdateMenuItem(selectedMenu.id, {
                              platformFeePct: Math.min(60, Math.max(0, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                    )}
                  </div>

                  {selectedMenu.overheadMode === 'custom' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Chiết khấu App / Sàn (%)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step="0.5"
                        value={selectedMenu.platformFeePct}
                        onChange={(e) =>
                          onUpdateMenuItem(selectedMenu.id, {
                            platformFeePct: Math.min(60, Math.max(0, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  )}

                  <div className="divide-y divide-slate-100 text-sm pt-2 border-t border-slate-200">
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-slate-600">Chi phí Nguyên vật liệu (1 phần)</span>
                      <span className="font-mono-num font-medium text-slate-900">
                        {formatVND(costing.ingredientsCostPerUnit)}
                      </span>
                    </div>
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-slate-600">Chi phí Bao bì &amp; Đóng gói</span>
                      <span className="font-mono-num font-medium text-slate-900">
                        {formatVND(costing.packagingCostPerUnit)}
                      </span>
                    </div>
                    <div className="py-2 flex items-center justify-between">
                      <span className="font-medium text-slate-800">Giá vốn trực tiếp (COGS)</span>
                      <span className="font-mono-num font-semibold text-slate-900">
                        {formatVND(costing.cogsPerUnit)}
                      </span>
                    </div>
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-slate-600">Phân bổ Cố định &amp; Mặt bằng</span>
                      <span className="font-mono-num text-slate-700">
                        {formatVND(costing.overheadPerUnit)}
                      </span>
                    </div>
                    {costing.platformFeePerUnit > 0 && (
                      <div className="py-2 flex items-center justify-between">
                        <span className="text-slate-600">
                          Phí sàn / App ({selectedMenu.platformFeePct}%)
                        </span>
                        <span className="font-mono-num text-slate-700">
                          {formatVND(costing.platformFeePerUnit)}
                        </span>
                      </div>
                    )}
                    <div className="py-2.5 flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        Tổng giá thành 1 sản phẩm
                      </span>
                      <span className="font-mono-num text-base font-bold text-slate-900">
                        {formatVND(costing.totalUnitCost)}
                      </span>
                    </div>
                    {costing.totalCaloriesPerUnit > 0 && (
                      <div className="py-2 flex items-center justify-between text-xs text-slate-500">
                        <span>Năng lượng ước tính</span>
                        <span className="font-mono-num">
                          {formatNumber(costing.totalCaloriesPerUnit, 1)} kcal / phần
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Pricing Simulator & Profit Output */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-2">
                      <span>% Food Cost mục tiêu (COGS / Giá bán)</span>
                      <span className="font-mono-num font-semibold text-teal-700">
                        {targetFoodCostPct}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={60}
                      step={1}
                      value={targetFoodCostPct}
                      onChange={(e) => setTargetFoodCostPct(Number(e.target.value))}
                      className="w-full accent-teal-700"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">
                        Giá bán đề xuất (làm tròn 1.000đ):{' '}
                        <strong className="font-mono-num text-slate-900">
                          {formatVND(costing.suggestedPriceByFoodCost(targetFoodCostPct))}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateMenuItem(selectedMenu.id, {
                            sellingPrice: costing.suggestedPriceByFoodCost(targetFoodCostPct),
                          })
                        }
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 hover:border-teal-600 text-teal-700 rounded-md whitespace-nowrap"
                      >
                        Áp dụng
                      </button>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200">
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Giá bán thực tế trên Menu (VNĐ)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={selectedMenu.sellingPrice}
                      onChange={(e) =>
                        onUpdateMenuItem(selectedMenu.id, {
                          sellingPrice: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3.5 py-2.5 text-lg font-mono-num font-bold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div className="space-y-2.5 pt-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Lãi gộp (Giá bán − COGS)</span>
                      <span className="font-mono-num font-semibold text-slate-900">
                        {formatVND(costing.grossProfit)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Lãi ròng (sau cố định &amp; phí sàn)</span>
                      <span
                        className={`font-mono-num text-base font-bold ${
                          costing.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatVND(costing.netProfit)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200">
                      <span className="text-slate-500">
                        Food Cost: <strong className="font-mono-num text-slate-800">{formatPercent(costing.foodCostPct)}</strong> · Biên ròng:{' '}
                        <strong className="font-mono-num text-slate-800">{formatPercent(costing.netMarginPct)}</strong>
                      </span>
                      <span
                        className={`font-semibold ${
                          costing.healthStatus === 'optimal'
                            ? 'text-emerald-700'
                            : costing.healthStatus === 'warning'
                              ? 'text-amber-700'
                              : 'text-red-600'
                        }`}
                      >
                        {costing.healthLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
