import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { CatalogItem, ItemCategory, RecipeLineItem } from '../types/costing';
import {
  computeCatalogCaloriesPerRetailUnit,
  computeCatalogUnitStats,
  exportCatalogToCSV,
  formatNumber,
  formatVND,
  hasCyclicDependency,
  normalizeVietnamese,
  parseExcelCSV,
  triggerDownloadCSV,
} from '../utils/formatters';

interface CatalogViewProps {
  catalog: CatalogItem[];
  onAdd: (item: Omit<CatalogItem, 'id'>) => void;
  onUpdate: (id: string, patch: Partial<CatalogItem>) => void;
  onDelete: (id: string) => void;
  onImport: (items: CatalogItem[], mode: 'merge' | 'replace') => void;
}

const CATEGORIES: Array<'Tất cả' | ItemCategory> = [
  'Tất cả',
  'Nguyên vật liệu',
  'Bán thành phẩm',
  'Bao bì',
  'Công cụ dụng cụ',
];

function createEmptyItem(category: ItemCategory = 'Nguyên vật liệu', nextIndex = 1): Omit<CatalogItem, 'id'> {
  const prefix =
    category === 'Nguyên vật liệu'
      ? 'NVL'
      : category === 'Bán thành phẩm'
        ? 'BTP'
        : category === 'Bao bì'
          ? 'BB'
          : 'CCDC';
  return {
    checked: false,
    code: `${prefix}${String(nextIndex).padStart(3, '0')}`,
    name: '',
    category,
    qcChan: 1,
    dvtChan:
      category === 'Bán thành phẩm'
        ? 'Mẻ'
        : category === 'Bao bì'
          ? 'Thùng'
          : category === 'Công cụ dụng cụ'
            ? 'Cái'
            : 'Gói',
    purchasePrices: category === 'Bán thành phẩm' ? [] : [0],
    subIngredients: category === 'Bán thành phẩm' ? [] : undefined,
    lossRate: 0,
    qcLe:
      category === 'Nguyên vật liệu'
        ? 1000
        : category === 'Bán thành phẩm'
          ? 500
          : 1,
    dvtLe:
      category === 'Nguyên vật liệu'
        ? 'gr'
        : category === 'Bán thành phẩm'
          ? 'ml'
          : 'cái',
    caloPerUnit: undefined,
    caloPerRetailUnit: undefined,
    depreciationMonths: category === 'Công cụ dụng cụ' ? 12 : undefined,
    note: '',
  };
}

export function CatalogView({
  catalog,
  onAdd,
  onUpdate,
  onDelete,
  onImport,
}: CatalogViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<'Tất cả' | ItemCategory>('Tất cả');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [formState, setFormState] = useState<Omit<CatalogItem, 'id'>>(createEmptyItem());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [subPickerSearch, setSubPickerSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const catalogMap = useMemo(() => {
    return new Map(catalog.map((c) => [c.id, c]));
  }, [catalog]);

  const counts = useMemo(() => {
    return {
      all: catalog.length,
      nvl: catalog.filter((c) => c.category === 'Nguyên vật liệu').length,
      btp: catalog.filter((c) => c.category === 'Bán thành phẩm').length,
      bb: catalog.filter((c) => c.category === 'Bao bì').length,
      ccdc: catalog.filter((c) => c.category === 'Công cụ dụng cụ').length,
    };
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = normalizeVietnamese(search);
    return catalog.filter((item) => {
      if (categoryFilter !== 'Tất cả' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        normalizeVietnamese(item.code).includes(q) ||
        normalizeVietnamese(item.name).includes(q) ||
        normalizeVietnamese(item.dvtLe).includes(q) ||
        normalizeVietnamese(item.note).includes(q)
      );
    });
  }, [catalog, categoryFilter, search]);

  const openCreateModal = () => {
    const defaultCat: ItemCategory =
      categoryFilter === 'Tất cả' ? 'Nguyên vật liệu' : categoryFilter;
    const catCount = catalog.filter((c) => c.category === defaultCat).length + 1;
    setFormState(createEmptyItem(defaultCat, catCount));
    setSubPickerSearch('');
    setEditingId('new');
  };

  const openEditModal = (item: CatalogItem) => {
    setFormState({
      checked: item.checked,
      code: item.code,
      name: item.name,
      category: item.category,
      qcChan: item.qcChan,
      dvtChan: item.dvtChan,
      purchasePrices: item.purchasePrices.length > 0 ? [...item.purchasePrices] : [0],
      subIngredients: item.subIngredients ? item.subIngredients.map((l) => ({ ...l })) : [],
      lossRate: item.lossRate,
      qcLe: item.qcLe,
      dvtLe: item.dvtLe,
      caloPerUnit: item.caloPerUnit,
      caloPerRetailUnit: item.caloPerRetailUnit,
      depreciationMonths: item.depreciationMonths ?? 12,
      note: item.note,
    });
    setSubPickerSearch('');
    setEditingId(item.id);
  };

  const availableSubComponents = useMemo(() => {
    const q = normalizeVietnamese(subPickerSearch);
    const currentId = editingId && editingId !== 'new' ? editingId : '';
    return catalog
      .filter((c) => c.category === 'Nguyên vật liệu' || c.category === 'Bán thành phẩm')
      .filter((c) => {
        if (currentId && hasCyclicDependency(currentId, c.id, catalogMap)) {
          return false;
        }
        if (!q) return true;
        return (
          normalizeVietnamese(c.name).includes(q) ||
          normalizeVietnamese(c.code).includes(q)
        );
      });
  }, [catalog, catalogMap, editingId, subPickerSearch]);

  const liveFormStats = useMemo(() => {
    const previewId = editingId && editingId !== 'new' ? editingId : 'preview';
    const previewItem: CatalogItem = { id: previewId, ...formState };
    return computeCatalogUnitStats(previewItem, catalogMap);
  }, [formState, catalogMap, editingId]);

  const handleAddSubIngredient = (catalogItemId: string) => {
    const currentLines: RecipeLineItem[] = formState.subIngredients || [];
    const existing = currentLines.find((l) => l.catalogItemId === catalogItemId);
    if (existing) {
      setFormState({
        ...formState,
        subIngredients: currentLines.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 10 } : l
        ),
      });
    } else {
      setFormState({
        ...formState,
        subIngredients: [
          ...currentLines,
          {
            id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            catalogItemId,
            quantity: 50,
          },
        ],
      });
    }
    setSubPickerSearch('');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim()) return;
    const isBtp = formState.category === 'Bán thành phẩm';
    const cleanedPrices = isBtp ? [] : formState.purchasePrices.filter((p) => p > 0);
    const payload: Omit<CatalogItem, 'id'> = {
      ...formState,
      code: formState.code.trim().toUpperCase() || (isBtp ? 'BTP001' : 'SP001'),
      name: formState.name.trim(),
      purchasePrices: isBtp ? [] : cleanedPrices.length > 0 ? cleanedPrices : [0],
      subIngredients: isBtp ? formState.subIngredients || [] : undefined,
      qcChan: formState.qcChan > 0 ? formState.qcChan : 1,
      qcLe: formState.qcLe > 0 ? formState.qcLe : 1,
    };
    if (editingId === 'new') {
      onAdd(payload);
    } else if (editingId) {
      onUpdate(editingId, payload);
    }
    setEditingId(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseExcelCSV(text);
      if (parsed.length > 0) {
        onImport(parsed, 'merge');
        setImportFeedback(`Đã nhập thành công ${parsed.length} mã hàng từ CSV.`);
      } else {
        setImportFeedback('Không đọc được dòng dữ liệu hợp lệ từ tệp CSV.');
      }
      setTimeout(() => setImportFeedback(null), 5000);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleExport = () => {
    const csv = exportCatalogToCSV(catalog);
    triggerDownloadCSV('danh_muc_nguyen_lieu_bao_bi.csv', csv);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Kho dữ liệu Nguyên vật liệu, Bán thành phẩm, Bao bì &amp; CCDC
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Quy đổi giá nhập chẵn sang đơn giá lẻ (gr, ml, cái) hoặc tạo Bán thành phẩm từ nhiều nguyên liệu để tính giá thành đồng bộ.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4 text-slate-500" />
            <span>Nhập CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Xuất CSV</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm hàng hóa</span>
          </button>
        </div>
      </div>

      {importFeedback && (
        <div className="px-4 py-3 bg-teal-50 border border-teal-200 text-teal-900 text-sm rounded-lg flex items-center justify-between">
          <span>{importFeedback}</span>
          <button
            type="button"
            onClick={() => setImportFeedback(null)}
            className="text-teal-700 hover:text-teal-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {CATEGORIES.map((cat) => {
              const count =
                cat === 'Tất cả'
                  ? counts.all
                  : cat === 'Nguyên vật liệu'
                    ? counts.nvl
                    : cat === 'Bán thành phẩm'
                      ? counts.btp
                      : cat === 'Bao bì'
                        ? counts.bb
                        : counts.ccdc;
              return (
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
                  {cat} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tra cứu mã hàng, tên hàng, đơn vị..."
              className="w-full lg:w-80 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
            />
          </div>
        </div>

        {/* High-Density Excel-Modeled Table */}
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900">Không tìm thấy mã hàng phù hợp</p>
            <p className="text-xs text-slate-500 mt-1">
              Thử đổi bộ lọc nhóm hàng hoặc nhấn &ldquo;Thêm hàng hóa&rdquo; để tạo mới.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-3 text-center w-10">Check</th>
                  <th className="py-3 px-3 whitespace-nowrap">Mã hàng</th>
                  <th className="py-3 px-3 whitespace-nowrap">Tên hàng hóa</th>
                  <th className="py-3 px-3 whitespace-nowrap">Nhóm hàng</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">QC chẵn</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá nhập TB</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Hao hụt</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">QC lẻ</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Giá ĐV lẻ (đ)</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Calo / Khấu hao</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((item) => {
                  const stats = computeCatalogUnitStats(item, catalogMap);
                  const caloRetail = computeCatalogCaloriesPerRetailUnit(item, catalogMap);
                  const isBtp = item.category === 'Bán thành phẩm';
                  const isDeleting = confirmDeleteId === item.id;
                  const btpSummary = isBtp && item.subIngredients?.length
                    ? item.subIngredients
                        .map((l) => {
                          const comp = catalogMap.get(l.catalogItemId);
                          return comp ? `${comp.name} (${formatNumber(l.quantity)} ${comp.dvtLe})` : null;
                        })
                        .filter(Boolean)
                        .join(' + ')
                    : '';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/90 transition-colors">
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => onUpdate(item.id, { checked: !item.checked })}
                          aria-label={`Đánh dấu ${item.code}`}
                          className={`w-5 h-5 rounded border inline-flex items-center justify-center transition-colors ${
                            item.checked
                              ? 'bg-teal-700 border-teal-700 text-white'
                              : 'bg-white border-slate-300 text-transparent hover:border-slate-400'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="py-2.5 px-3 font-mono-num text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {item.code}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900 min-w-[200px]">{item.name}</div>
                        {(btpSummary || item.note) && (
                          <div className="text-xs text-slate-400 truncate max-w-[280px]">
                            {btpSummary || item.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatNumber(item.qcChan)} {item.dvtChan}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-mono-num font-medium text-slate-900">
                          {formatVND(stats.avgPurchasePrice, false)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {isBtp
                            ? `${item.subIngredients?.length || 0} thành phần`
                            : `${item.purchasePrices.filter((p) => p > 0).length} giá nhập`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-slate-600 whitespace-nowrap">
                        {item.lossRate > 0 ? `${item.lossRate}%` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-slate-700 whitespace-nowrap">
                        {formatNumber(item.qcLe)} {item.dvtLe}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className="font-mono-num font-semibold text-teal-800">
                          {formatVND(stats.unitPrice, false)}
                        </span>
                        <span className="text-xs text-slate-400 ml-1">/{item.dvtLe}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num text-xs text-slate-600 whitespace-nowrap">
                        {item.category === 'Công cụ dụng cụ'
                          ? `${formatVND(stats.monthlyDepreciation, false)}/th`
                          : caloRetail > 0 || item.caloPerRetailUnit !== undefined
                            ? `${formatNumber(caloRetail)} cal`
                            : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {!isDeleting ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-teal-50 rounded-md transition-colors"
                              title="Chỉnh sửa"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title="Xóa hàng hóa"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDelete(item.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Xóa
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                            >
                              Hủy
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Slide-over Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="w-full max-w-xl bg-white h-full shadow-xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                {editingId === 'new' ? 'Thêm hàng hóa mới' : `Chỉnh sửa: ${formState.code}`}
              </h2>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã hàng *
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.code}
                    onChange={(e) => setFormState({ ...formState, code: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="NVL027"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nhóm hàng *
                  </label>
                  <select
                    value={formState.category}
                    onChange={(e) => {
                      const nextCat = e.target.value as ItemCategory;
                      const catCount = catalog.filter((c) => c.category === nextCat).length + 1;
                      const prefix =
                        nextCat === 'Nguyên vật liệu'
                          ? 'NVL'
                          : nextCat === 'Bán thành phẩm'
                            ? 'BTP'
                            : nextCat === 'Bao bì'
                              ? 'BB'
                              : 'CCDC';
                      setFormState({
                        ...formState,
                        category: nextCat,
                        code:
                          editingId === 'new'
                            ? `${prefix}${String(catCount).padStart(3, '0')}`
                            : formState.code,
                        dvtChan: nextCat === 'Bán thành phẩm' ? 'Mẻ' : formState.dvtChan,
                        subIngredients:
                          nextCat === 'Bán thành phẩm'
                            ? formState.subIngredients || []
                            : formState.subIngredients,
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="Nguyên vật liệu">Nguyên vật liệu</option>
                    <option value="Bán thành phẩm">Bán thành phẩm</option>
                    <option value="Bao bì">Bao bì</option>
                    <option value="Công cụ dụng cụ">Công cụ dụng cụ</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên hàng hóa *
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder={
                    formState.category === 'Bán thành phẩm'
                      ? 'Ví dụ: CỐT CÀ PHÊ ĐEN hoặc CỐT CÀ PHÊ SỮA'
                      : 'Ví dụ: SỮA TƯƠI THANH TRÙNG DALAT MILK 950ML'
                  }
                />
              </div>

              {/* Quy cách chẵn & lẻ */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {formState.category === 'Bán thành phẩm' ? 'Số mẻ' : 'QC chẵn'}
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={formState.qcChan}
                    onChange={(e) =>
                      setFormState({ ...formState, qcChan: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {formState.category === 'Bán thành phẩm' ? 'ĐVT mẻ' : 'ĐVT chẵn'}
                  </label>
                  <input
                    type="text"
                    value={formState.dvtChan}
                    onChange={(e) => setFormState({ ...formState, dvtChan: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder={formState.category === 'Bán thành phẩm' ? 'Mẻ / Nồi' : 'Thùng / Gói'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {formState.category === 'Bán thành phẩm' ? 'Sản lượng thu được' : 'QC lẻ'}
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={formState.qcLe}
                    onChange={(e) =>
                      setFormState({ ...formState, qcLe: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ĐVT lẻ
                  </label>
                  <input
                    type="text"
                    value={formState.dvtLe}
                    onChange={(e) => setFormState({ ...formState, dvtLe: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="gr / ml / cái"
                  />
                </div>
              </div>

              {formState.category === 'Bán thành phẩm' ? (
                /* Thành phần cấu tạo Bán thành phẩm */
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-800">
                        Nguyên liệu &amp; Bán thành phẩm cấu tạo nên 1 mẻ
                      </h3>
                      <p className="text-xs text-slate-500">
                        Tổng giá vốn mẻ hiện tại:{' '}
                        <strong className="font-mono-num text-slate-900">
                          {formatVND(liveFormStats.avgPurchasePrice)}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={subPickerSearch}
                      onChange={(e) => setSubPickerSearch(e.target.value)}
                      placeholder="+ Tìm nguyên liệu hoặc bán thành phẩm để thêm..."
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                    {subPickerSearch.trim() !== '' && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto z-20 divide-y divide-slate-100">
                        {availableSubComponents.length === 0 ? (
                          <div className="p-3 text-xs text-slate-500">
                            Không tìm thấy thành phần phù hợp
                          </div>
                        ) : (
                          availableSubComponents.slice(0, 12).map((comp) => {
                            const st = computeCatalogUnitStats(comp, catalogMap);
                            return (
                              <button
                                key={comp.id}
                                type="button"
                                onClick={() => handleAddSubIngredient(comp.id)}
                                className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 truncate">
                                    {comp.name}
                                  </div>
                                  <div className="text-slate-400">
                                    <span className="font-mono-num">{comp.code}</span> · {comp.category}
                                  </div>
                                </div>
                                <div className="font-mono-num text-teal-700 font-medium shrink-0">
                                  {formatVND(st.unitPrice, false)}/{comp.dvtLe}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  {!formState.subIngredients || formState.subIngredients.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-500">
                      Chưa có thành phần nào. Gõ tên nguyên liệu (ví dụ: Cà phê, Nước sôi, Sữa đặc...) ở ô phía trên để thêm.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                      {formState.subIngredients.map((line) => {
                        const comp = catalogMap.get(line.catalogItemId);
                        if (!comp) return null;
                        const compStats = computeCatalogUnitStats(comp, catalogMap);
                        const lineCost = compStats.unitPrice * (line.quantity || 0);
                        return (
                          <div
                            key={line.id}
                            className="px-3 py-2.5 flex items-center justify-between gap-2 text-sm bg-white"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-slate-900 truncate text-xs sm:text-sm">
                                {comp.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                <span className="font-mono-num">{comp.code}</span> · {comp.category} ·{' '}
                                <span className="font-mono-num">
                                  {formatVND(compStats.unitPrice, false)}/{comp.dvtLe}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={line.quantity}
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value) || 0);
                                  setFormState({
                                    ...formState,
                                    subIngredients: (formState.subIngredients || []).map((l) =>
                                      l.id === line.id ? { ...l, quantity: val } : l
                                    ),
                                  });
                                }}
                                className="w-20 px-2 py-1 text-right font-mono-num text-sm border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-teal-600"
                              />
                              <span className="text-xs text-slate-500 w-7">{comp.dvtLe}</span>
                              <span className="font-mono-num text-xs font-medium text-slate-800 w-20 text-right">
                                {formatVND(lineCost, false)} đ
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setFormState({
                                    ...formState,
                                    subIngredients: (formState.subIngredients || []).filter(
                                      (l) => l.id !== line.id
                                    ),
                                  })
                                }
                                className="p-1 text-slate-400 hover:text-red-600"
                                title="Xóa thành phần"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Giá nhập 1..9 */
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-800">
                        Lịch sử giá nhập (tối đa 9 lần — tự động tính trung bình)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Giá nhập TB hiện tại:{' '}
                        <strong className="font-mono-num text-slate-900">
                          {formatVND(liveFormStats.avgPurchasePrice)}
                        </strong>
                      </p>
                    </div>
                    {formState.purchasePrices.length < 9 && (
                      <button
                        type="button"
                        onClick={() =>
                          setFormState({
                            ...formState,
                            purchasePrices: [...formState.purchasePrices, 0],
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm lần nhập</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {formState.purchasePrices.map((price, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 w-9 shrink-0">Lần {idx + 1}</span>
                        <input
                          type="number"
                          min={0}
                          value={price || ''}
                          onChange={(e) => {
                            const next = [...formState.purchasePrices];
                            next[idx] = Number(e.target.value) || 0;
                            setFormState({ ...formState, purchasePrices: next });
                          }}
                          className="w-full px-2.5 py-1.5 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                          placeholder="0"
                        />
                        {formState.purchasePrices.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = formState.purchasePrices.filter((_, i) => i !== idx);
                              setFormState({ ...formState, purchasePrices: next });
                            }}
                            className="p-1 text-slate-400 hover:text-red-600"
                            title="Xóa lần nhập"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hao hụt & Calo / Khấu hao */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tỉ lệ hao hụt (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step="0.5"
                    value={formState.lossRate || ''}
                    onChange={(e) =>
                      setFormState({ ...formState, lossRate: Number(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="0"
                  />
                </div>

                {formState.category === 'Công cụ dụng cụ' ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Thời gian khấu hao (tháng)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={formState.depreciationMonths ?? 12}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          depreciationMonths: Number(e.target.value) || 12,
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Calo / ĐV chẵn
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={formState.caloPerUnit ?? ''}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            caloPerUnit: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        placeholder="Không bắt buộc"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Calo / ĐV lẻ ({formState.dvtLe})
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={formState.caloPerRetailUnit ?? ''}
                        onChange={(e) =>
                          setFormState({
                            ...formState,
                            caloPerRetailUnit:
                              e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        placeholder="Không bắt buộc"
                      />
                    </div>
                  </>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={formState.note}
                  onChange={(e) => setFormState({ ...formState, note: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  placeholder="Nhà cung cấp hoặc lưu ý bảo quản..."
                />
              </div>

              {/* Live Formula Output Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Tổng đơn vị lẻ khả dụng</span>
                  <span className="font-mono-num text-slate-800">
                    {formatNumber(liveFormStats.effectiveRetailUnits)} {formState.dvtLe}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-sm font-semibold text-slate-900">
                    Đơn giá lẻ quy đổi (Giá ĐV)
                  </span>
                  <span className="font-mono-num text-lg font-bold text-teal-700">
                    {formatVND(liveFormStats.unitPrice)} / {formState.dvtLe}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  Lưu hàng hóa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
