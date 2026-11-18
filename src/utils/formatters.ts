import { CatalogItem, FixedCostItem, MenuItem, OverheadConfig } from '../types/costing';

export function normalizeVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function parseVNNumber(raw: string | undefined | null): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/\s+/g, '').replace(/"/g, '').trim();
  if (!cleaned) return 0;
  // Handle Vietnamese thousands separator (.) and decimal separator (,)
  // e.g. "4.425.000" -> 4425000, "3,5" -> 3.5, "1.000" -> 1000
  const hasComma = cleaned.includes(',');
  const dotCount = (cleaned.match(/\./g) || []).length;
  let normalized = cleaned;
  if (hasComma) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (dotCount > 1) {
    normalized = cleaned.replace(/\./g, '');
  } else if (dotCount === 1) {
    // Check if single dot looks like thousands separator (3 digits after dot)
    const parts = cleaned.split('.');
    if (parts[1] && parts[1].length === 3) {
      normalized = cleaned.replace('.', '');
    }
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

export function formatVND(value: number, showSuffix = true): string {
  const rounded = Math.round(value);
  const formatted = new Intl.NumberFormat('vi-VN').format(rounded);
  return showSuffix ? `${formatted} đ` : formatted;
}

export function formatNumber(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(decimals)}%`;
}

export interface CatalogUnitStats {
  avgPurchasePrice: number;
  totalRetailUnits: number;
  effectiveRetailUnits: number;
  unitPrice: number;
  monthlyDepreciation: number;
}

export function computeCatalogUnitStats(
  item: CatalogItem,
  catalogMap?: Map<string, CatalogItem>,
  visited: Set<string> = new Set()
): CatalogUnitStats {
  const qcChan = item.qcChan > 0 ? item.qcChan : 1;
  const qcLe = item.qcLe > 0 ? item.qcLe : 1;
  const totalRetailUnits = qcChan * qcLe;

  const clampedLoss = Math.min(Math.max(item.lossRate || 0, 0), 99);
  const usableRatio = 1 - clampedLoss / 100;
  const effectiveRetailUnits = totalRetailUnits * usableRatio;

  let avgPurchasePrice = 0;

  if (item.category === 'Bán thành phẩm') {
    if (!visited.has(item.id) && catalogMap && item.subIngredients && item.subIngredients.length > 0) {
      const nextVisited = new Set(visited);
      nextVisited.add(item.id);
      for (const line of item.subIngredients) {
        const subItem = catalogMap.get(line.catalogItemId);
        if (!subItem || nextVisited.has(subItem.id)) continue;
        const subStats = computeCatalogUnitStats(subItem, catalogMap, nextVisited);
        avgPurchasePrice += subStats.unitPrice * (line.quantity || 0);
      }
    }
  } else {
    const validPrices = item.purchasePrices.filter((p) => Number.isFinite(p) && p > 0);
    avgPurchasePrice =
      validPrices.length > 0
        ? validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length
        : 0;
  }

  const unitPrice = effectiveRetailUnits > 0 ? avgPurchasePrice / effectiveRetailUnits : 0;

  const depMonths =
    item.depreciationMonths && item.depreciationMonths > 0 ? item.depreciationMonths : 12;
  const monthlyDepreciation =
    item.category === 'Công cụ dụng cụ' ? avgPurchasePrice / depMonths : 0;

  return {
    avgPurchasePrice,
    totalRetailUnits,
    effectiveRetailUnits,
    unitPrice,
    monthlyDepreciation,
  };
}

export function computeCatalogCaloriesPerRetailUnit(
  item: CatalogItem,
  catalogMap?: Map<string, CatalogItem>,
  visited: Set<string> = new Set()
): number {
  if (item.category !== 'Bán thành phẩm') {
    return item.caloPerRetailUnit || 0;
  }
  if (visited.has(item.id) || !catalogMap || !item.subIngredients?.length) {
    return item.caloPerRetailUnit || 0;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(item.id);
  let totalCalo = 0;
  for (const line of item.subIngredients) {
    const subItem = catalogMap.get(line.catalogItemId);
    if (!subItem || nextVisited.has(subItem.id)) continue;
    totalCalo +=
      computeCatalogCaloriesPerRetailUnit(subItem, catalogMap, nextVisited) *
      (line.quantity || 0);
  }
  const qcChan = item.qcChan > 0 ? item.qcChan : 1;
  const qcLe = item.qcLe > 0 ? item.qcLe : 1;
  const clampedLoss = Math.min(Math.max(item.lossRate || 0, 0), 99);
  const effectiveRetailUnits = qcChan * qcLe * (1 - clampedLoss / 100);
  return effectiveRetailUnits > 0 ? totalCalo / effectiveRetailUnits : 0;
}

export function hasCyclicDependency(
  targetId: string,
  candidateComponentId: string,
  catalogMap: Map<string, CatalogItem>,
  visited: Set<string> = new Set()
): boolean {
  if (targetId === candidateComponentId) return true;
  if (visited.has(candidateComponentId)) return false;
  const candidate = catalogMap.get(candidateComponentId);
  if (!candidate || candidate.category !== 'Bán thành phẩm' || !candidate.subIngredients) {
    return false;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(candidateComponentId);
  return candidate.subIngredients.some((line) =>
    hasCyclicDependency(targetId, line.catalogItemId, catalogMap, nextVisited)
  );
}

export function computeMonthlyOverheadTotal(
  fixedCosts: FixedCostItem[],
  catalog: CatalogItem[],
  overheadConfig: OverheadConfig
): {
  fixedCostsSum: number;
  ccdcDepreciationSum: number;
  totalMonthlyOverhead: number;
  overheadPerUnit: number;
} {
  const fixedCostsSum = fixedCosts
    .filter((c) => c.active)
    .reduce((sum, c) => sum + (c.monthlyAmount || 0), 0);

  const ccdcDepreciationSum = overheadConfig.includeCcdcDepreciation
    ? catalog
        .filter((i) => i.category === 'Công cụ dụng cụ')
        .reduce((sum, i) => sum + computeCatalogUnitStats(i).monthlyDepreciation, 0)
    : 0;

  const totalMonthlyOverhead = fixedCostsSum + ccdcDepreciationSum;
  const units = overheadConfig.projectedMonthlyUnits > 0 ? overheadConfig.projectedMonthlyUnits : 1;
  const overheadPerUnit = totalMonthlyOverhead / units;

  return {
    fixedCostsSum,
    ccdcDepreciationSum,
    totalMonthlyOverhead,
    overheadPerUnit,
  };
}

export interface MenuItemCosting {
  ingredientsBatchCost: number;
  ingredientsCostPerUnit: number;
  packagingCostPerUnit: number;
  cogsPerUnit: number; // Giá vốn trực tiếp = NVL + Bao bì
  overheadPerUnit: number;
  platformFeePerUnit: number;
  totalUnitCost: number; // Tổng giá thành = COGS + Overhead + Platform Fee
  grossProfit: number; // Lãi gộp = Giá bán - COGS
  netProfit: number; // Lãi ròng = Giá bán - Tổng giá thành
  foodCostPct: number; // % COGS / Giá bán
  totalCostPct: number; // % Tổng giá thành / Giá bán
  netMarginPct: number; // % Lãi ròng / Giá bán
  totalCaloriesPerUnit: number;
  suggestedPriceByFoodCost: (targetPct: number) => number;
  healthStatus: 'optimal' | 'warning' | 'high';
  healthLabel: string;
}

export function computeMenuItemCosting(
  menuItem: MenuItem,
  catalogMap: Map<string, CatalogItem>,
  autoOverheadPerUnit: number
): MenuItemCosting {
  const yieldCount = menuItem.yieldCount > 0 ? menuItem.yieldCount : 1;

  let ingredientsBatchCost = 0;
  let totalCaloriesBatch = 0;

  for (const line of menuItem.ingredients) {
    const cat = catalogMap.get(line.catalogItemId);
    if (!cat) continue;
    const stats = computeCatalogUnitStats(cat, catalogMap);
    ingredientsBatchCost += stats.unitPrice * (line.quantity || 0);
    const caloPerUnit = computeCatalogCaloriesPerRetailUnit(cat, catalogMap);
    if (caloPerUnit > 0) {
      totalCaloriesBatch += caloPerUnit * (line.quantity || 0);
    }
  }

  const ingredientsCostPerUnit = ingredientsBatchCost / yieldCount;
  const totalCaloriesPerUnit = totalCaloriesBatch / yieldCount;

  let packagingCostPerUnit = 0;
  for (const line of menuItem.packaging) {
    const cat = catalogMap.get(line.catalogItemId);
    if (!cat) continue;
    const stats = computeCatalogUnitStats(cat, catalogMap);
    packagingCostPerUnit += stats.unitPrice * (line.quantity || 0);
  }

  const cogsPerUnit = ingredientsCostPerUnit + packagingCostPerUnit;

  let overheadPerUnit = 0;
  if (menuItem.overheadMode === 'auto') {
    overheadPerUnit = autoOverheadPerUnit;
  } else if (menuItem.overheadMode === 'custom') {
    overheadPerUnit = menuItem.customOverheadPerUnit || 0;
  }

  const sellingPrice = menuItem.sellingPrice || 0;
  const platformFeePerUnit = sellingPrice * ((menuItem.platformFeePct || 0) / 100);

  const totalUnitCost = cogsPerUnit + overheadPerUnit + platformFeePerUnit;
  const grossProfit = sellingPrice - cogsPerUnit;
  const netProfit = sellingPrice - totalUnitCost;

  const foodCostPct = sellingPrice > 0 ? (cogsPerUnit / sellingPrice) * 100 : 0;
  const totalCostPct = sellingPrice > 0 ? (totalUnitCost / sellingPrice) * 100 : 0;
  const netMarginPct = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

  let healthStatus: 'optimal' | 'warning' | 'high' = 'optimal';
  let healthLabel = 'Tối ưu';
  if (sellingPrice <= 0 || foodCostPct > 40 || netProfit < 0) {
    healthStatus = 'high';
    healthLabel = netProfit < 0 ? 'Đang lỗ' : 'Giá vốn cao';
  } else if (foodCostPct > 30) {
    healthStatus = 'warning';
    healthLabel = 'Cần theo dõi';
  }

  return {
    ingredientsBatchCost,
    ingredientsCostPerUnit,
    packagingCostPerUnit,
    cogsPerUnit,
    overheadPerUnit,
    platformFeePerUnit,
    totalUnitCost,
    grossProfit,
    netProfit,
    foodCostPct,
    totalCostPct,
    netMarginPct,
    totalCaloriesPerUnit,
    suggestedPriceByFoodCost: (targetPct: number) => {
      const safePct = Math.min(Math.max(targetPct, 5), 95);
      return Math.ceil(cogsPerUnit / (safePct / 100) / 1000) * 1000;
    },
    healthStatus,
    healthLabel,
  };
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseExcelCSV(csvText: string): CatalogItem[] {
  // Handle multi-line quoted headers cleanly by parsing whole CSV text into rows
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.trim() !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  // Skip header row
  const items: CatalogItem[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length < 7) continue;
    const code = (cols[1] || '').trim();
    const name = (cols[2] || '').trim();
    if (!code && !name) continue;

    const rawCat = (cols[3] || '').trim();
    let category: CatalogItem['category'] = 'Nguyên vật liệu';
    if (rawCat.toLowerCase().includes('bán thành phẩm') || rawCat.toLowerCase().includes('btp')) {
      category = 'Bán thành phẩm';
    } else if (rawCat.toLowerCase().includes('bao')) {
      category = 'Bao bì';
    } else if (rawCat.toLowerCase().includes('công cụ') || rawCat.toLowerCase().includes('ccdc')) {
      category = 'Công cụ dụng cụ';
    }

    const qcChan = parseVNNumber(cols[4]) || 1;
    const dvtChan = (cols[5] || '').trim() || 'Cái';

    const purchasePrices: number[] = [];
    for (let p = 6; p <= 14; p++) {
      const val = parseVNNumber(cols[p]);
      if (val > 0) purchasePrices.push(val);
    }
    if (purchasePrices.length === 0) {
      const avgFallback = parseVNNumber(cols[15]);
      if (avgFallback > 0) purchasePrices.push(avgFallback);
    }

    const lossRate = parseVNNumber(cols[16]);
    const qcLe = parseVNNumber(cols[17]) || 1;
    const dvtLe = (cols[18] || '').trim() || 'cái';
    const caloPerUnit = parseVNNumber(cols[20]) || undefined;
    const caloPerRetailUnit = parseVNNumber(cols[21]) || undefined;
    const note = (cols[22] || '').trim();

    items.push({
      id: `item_${code || r}_${Date.now()}_${r}`,
      checked: (cols[0] || '').toUpperCase() === 'TRUE',
      code: code || `SP${String(r).padStart(3, '0')}`,
      name,
      category,
      qcChan,
      dvtChan,
      purchasePrices,
      lossRate,
      qcLe,
      dvtLe,
      caloPerUnit,
      caloPerRetailUnit,
      depreciationMonths: category === 'Công cụ dụng cụ' ? 12 : undefined,
      note,
    });
  }

  return items;
}

export function exportCatalogToCSV(catalog: CatalogItem[]): string {
  const headers = [
    'CHECK',
    'MÃ HÀNG',
    'TÊN HÀNG HÓA',
    'NHÓM HÀNG',
    'QC CHẴN',
    'ĐVT CHẴN',
    'GIÁ NHẬP 1',
    'GIÁ NHẬP 2',
    'GIÁ NHẬP 3',
    'GIÁ NHẬP 4',
    'GIÁ NHẬP 5',
    'GIÁ NHẬP 6',
    'GIÁ NHẬP 7',
    'GIÁ NHẬP 8',
    'GIÁ NHẬP 9',
    'GIÁ NHẬP TRUNG BÌNH',
    'TỈ LỆ HAO HỤT (%)',
    'QC LẺ',
    'ĐVT LẺ',
    'GIÁ ĐV (đ)',
    'NĂNG LƯỢNG CALO/ĐV',
    'NĂNG LƯỢNG ĐƠN VỊ LẺ',
    'GHI CHÚ',
  ];

  const escape = (val: string | number | boolean | undefined) => {
    const str = val === undefined ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escape).join(',')];

  const catalogMap = new Map(catalog.map((c) => [c.id, c]));

  for (const item of catalog) {
    const stats = computeCatalogUnitStats(item, catalogMap);
    const prices = Array.from({ length: 9 }, (_, idx) => item.purchasePrices[idx] || '');
    const row = [
      item.checked ? 'TRUE' : 'FALSE',
      item.code,
      item.name,
      item.category,
      item.qcChan,
      item.dvtChan,
      ...prices,
      Math.round(stats.avgPurchasePrice),
      item.lossRate || '',
      item.qcLe,
      item.dvtLe,
      Math.round(stats.unitPrice),
      item.caloPerUnit ?? '',
      item.caloPerRetailUnit ?? '',
      item.note || '',
    ];
    lines.push(row.map(escape).join(','));
  }

  return '\uFEFF' + lines.join('\n');
}

export function exportMenuCostToCSV(
  menuItems: MenuItem[],
  catalogMap: Map<string, CatalogItem>,
  autoOverheadPerUnit: number
): string {
  const headers = [
    'MÃ MÓN',
    'TÊN MÓN',
    'NHÓM MENU',
    'SIZE',
    'HIỂN THỊ MENU',
    'CHI PHÍ NVL (đ)',
    'CHI PHÍ BAO BÌ (đ)',
    'GIÁ VỐN TRỰC TIẾP (đ)',
    'PHÂN BỔ CỐ ĐỊNH (đ)',
    'PHÍ SÀN (đ)',
    'TỔNG GIÁ THÀNH (đ)',
    'GIÁ BÁN (đ)',
    'LÃI GỘP (đ)',
    'LÃI RÒNG (đ)',
    '% FOOD COST',
    '% LÃI RÒNG',
    'TRẠNG THÁI',
  ];

  const escape = (val: string | number) => {
    const str = String(val);
    if (str.includes(',') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escape).join(',')];

  for (const m of menuItems) {
    const c = computeMenuItemCosting(m, catalogMap, autoOverheadPerUnit);
    lines.push(
      [
        m.code,
        m.name,
        m.category,
        m.sizeLabel,
        m.isOnMenu ? 'Đang bán' : 'Ẩn',
        Math.round(c.ingredientsCostPerUnit),
        Math.round(c.packagingCostPerUnit),
        Math.round(c.cogsPerUnit),
        Math.round(c.overheadPerUnit),
        Math.round(c.platformFeePerUnit),
        Math.round(c.totalUnitCost),
        Math.round(m.sellingPrice),
        Math.round(c.grossProfit),
        Math.round(c.netProfit),
        c.foodCostPct.toFixed(1) + '%',
        c.netMarginPct.toFixed(1) + '%',
        c.healthLabel,
      ]
        .map(escape)
        .join(',')
    );
  }

  return '\uFEFF' + lines.join('\n');
}

export function triggerDownloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Keep unused export suppressed check clean
export { splitCSVLine };
