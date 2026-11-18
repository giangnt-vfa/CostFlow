import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  CatalogItem,
  FixedCostCategory,
  FixedCostItem,
  OverheadConfig,
} from '../types/costing';
import { computeCatalogUnitStats, formatVND } from '../utils/formatters';

interface FixedCostsViewProps {
  fixedCosts: FixedCostItem[];
  catalog: CatalogItem[];
  overheadConfig: OverheadConfig;
  overheadSummary: {
    fixedCostsSum: number;
    ccdcDepreciationSum: number;
    totalMonthlyOverhead: number;
    overheadPerUnit: number;
  };
  onAddFixedCost: (item: Omit<FixedCostItem, 'id'>) => void;
  onUpdateFixedCost: (id: string, patch: Partial<FixedCostItem>) => void;
  onDeleteFixedCost: (id: string) => void;
  onUpdateOverheadConfig: (patch: Partial<OverheadConfig>) => void;
}

const COST_CATEGORIES: FixedCostCategory[] = [
  'Mặt bằng',
  'Nhân sự cố định',
  'Điện nước & Vận hành',
  'Marketing & Khác',
];

export function FixedCostsView({
  fixedCosts,
  catalog,
  overheadConfig,
  overheadSummary,
  onAddFixedCost,
  onUpdateFixedCost,
  onDeleteFixedCost,
  onUpdateOverheadConfig,
}: FixedCostsViewProps) {
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<FixedCostCategory>('Mặt bằng');
  const [newAmount, setNewAmount] = useState<number>(0);
  const [newNote, setNewNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const ccdcItems = useMemo(() => {
    return catalog
      .filter((i) => i.category === 'Công cụ dụng cụ')
      .map((item) => ({
        item,
        stats: computeCatalogUnitStats(item),
      }));
  }, [catalog]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onAddFixedCost({
      name: newName.trim(),
      category: newCategory,
      monthlyAmount: Math.max(0, newAmount || 0),
      active: true,
      note: newNote.trim(),
    });
    setNewName('');
    setNewAmount(0);
    setNewNote('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
          Chi phí cố định, Mặt bằng &amp; Khấu hao CCDC
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Quản lý các khoản chi phí cố định hàng tháng (thuê mặt bằng, nhân sự, điện nước...) và cấu hình sản lượng dự kiến để phân bổ vào giá thành từng món.
        </p>
      </div>

      {/* Allocation Summary Strip */}
      <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Chi phí cố định &amp; MB / tháng</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {formatVND(overheadSummary.fixedCostsSum)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {fixedCosts.filter((c) => c.active).length} khoản chi đang bật
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Khấu hao CCDC / tháng</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {formatVND(overheadSummary.ccdcDepreciationSum)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Từ {ccdcItems.length} công cụ dụng cụ trong kho
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Tổng chi phí phân bổ / tháng</div>
          <div className="mt-2 font-mono-num text-2xl font-semibold text-slate-900">
            {formatVND(overheadSummary.totalMonthlyOverhead)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Tương đương {formatVND(overheadSummary.totalMonthlyOverhead / 30)} / ngày
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Định mức phân bổ / 1 sản phẩm</div>
          <div className="mt-2 font-mono-num text-2xl font-bold text-teal-700">
            {formatVND(overheadSummary.overheadPerUnit)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Chia cho {overheadConfig.projectedMonthlyUnits.toLocaleString('vi-VN')} phần/tháng
          </div>
        </div>
      </section>

      {/* Allocation Parameters */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-display text-base font-semibold text-slate-900 mb-4">
          Cấu hình quy tắc phân bổ vào giá thành
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Sản lượng bán dự kiến / tháng (ly, phần)
            </label>
            <input
              type="number"
              min={1}
              value={overheadConfig.projectedMonthlyUnits}
              onChange={(e) =>
                onUpdateOverheadConfig({
                  projectedMonthlyUnits: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Food Cost mục tiêu mặc định (%)
            </label>
            <input
              type="number"
              min={10}
              max={80}
              value={overheadConfig.defaultTargetFoodCostPct}
              onChange={(e) =>
                onUpdateOverheadConfig({
                  defaultTargetFoodCostPct: Math.min(80, Math.max(10, Number(e.target.value) || 30)),
                })
              }
              className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <label className="flex items-center justify-between px-3.5 py-2 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
            <span className="text-sm text-slate-700">
              Cộng tự động khấu hao CCDC
            </span>
            <input
              type="checkbox"
              checked={overheadConfig.includeCcdcDepreciation}
              onChange={(e) =>
                onUpdateOverheadConfig({ includeCcdcDepreciation: e.target.checked })
              }
              className="w-4 h-4 accent-teal-700"
            />
          </label>
        </div>
      </section>

      {/* Add Fixed Cost Form + Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-display text-base font-semibold text-slate-900 mb-3">
            Danh sách chi phí cố định &amp; mặt bằng
          </h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tên khoản chi (ví dụ: Thuê mặt bằng, Lương nhân viên...)"
              className="md:col-span-4 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as FixedCostCategory)}
              className="md:col-span-3 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              required
              value={newAmount || ''}
              onChange={(e) => setNewAmount(Number(e.target.value) || 0)}
              placeholder="Số tiền / tháng (đ)"
              className="md:col-span-2 px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ghi chú"
              className="md:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <button
              type="submit"
              className="md:col-span-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm</span>
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 w-16">Tính vào giá</th>
                <th className="py-3 px-3">Khoản chi phí</th>
                <th className="py-3 px-3">Nhóm chi phí</th>
                <th className="py-3 px-3 text-right">Số tiền / tháng (đ)</th>
                <th className="py-3 px-3">Ghi chú</th>
                <th className="py-3 px-4 text-right">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {fixedCosts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-slate-500">
                    Chưa có khoản chi phí cố định nào. Hãy thêm tiền thuê mặt bằng hoặc lương nhân viên ở biểu mẫu phía trên.
                  </td>
                </tr>
              ) : (
                fixedCosts.map((fc) => {
                  const isDeleting = confirmDeleteId === fc.id;
                  return (
                    <tr key={fc.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <input
                          type="checkbox"
                          checked={fc.active}
                          onChange={(e) =>
                            onUpdateFixedCost(fc.id, { active: e.target.checked })
                          }
                          className="w-4 h-4 accent-teal-700 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={fc.name}
                          onChange={(e) =>
                            onUpdateFixedCost(fc.id, { name: e.target.value })
                          }
                          className={`w-full px-2 py-1 text-sm bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-teal-600 rounded focus:outline-none ${
                            fc.active ? 'text-slate-900 font-medium' : 'text-slate-400 line-through'
                          }`}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={fc.category}
                          onChange={(e) =>
                            onUpdateFixedCost(fc.id, {
                              category: e.target.value as FixedCostCategory,
                            })
                          }
                          className="px-2 py-1 text-xs bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-teal-600 rounded focus:outline-none text-slate-600"
                        >
                          {COST_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={50000}
                          value={fc.monthlyAmount}
                          onChange={(e) =>
                            onUpdateFixedCost(fc.id, {
                              monthlyAmount: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-36 px-2.5 py-1 text-right font-mono-num font-medium text-slate-900 bg-transparent border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={fc.note}
                          onChange={(e) =>
                            onUpdateFixedCost(fc.id, { note: e.target.value })
                          }
                          placeholder="Thêm ghi chú..."
                          className="w-full px-2 py-1 text-xs text-slate-600 bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-teal-600 rounded focus:outline-none"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {!isDeleting ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(fc.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                            title="Xóa khoản chi"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteFixedCost(fc.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded"
                            >
                              Xóa
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded"
                            >
                              Hủy
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
