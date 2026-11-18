export type ItemCategory = 'Nguyên vật liệu' | 'Bao bì' | 'Công cụ dụng cụ';

export interface CatalogItem {
  id: string;
  checked: boolean;
  code: string;
  name: string;
  category: ItemCategory;
  qcChan: number; // Quy cách chẵn (e.g. 15, 1, 1000)
  dvtChan: string; // ĐVT chẵn (e.g. Gói, Hộp, Thùng)
  purchasePrices: number[]; // Giá nhập 1..9
  lossRate: number; // Tỉ lệ hao hụt (%)
  qcLe: number; // Quy cách lẻ (e.g. 1000, 500, 1)
  dvtLe: string; // ĐVT lẻ (e.g. gr, ml, cái)
  caloPerUnit?: number; // Năng lượng Calo/ĐV
  caloPerRetailUnit?: number; // Năng lượng đơn vị lẻ
  depreciationMonths?: number; // Số tháng khấu hao (áp dụng cho CCDC)
  note: string;
}

export type FixedCostCategory =
  | 'Mặt bằng'
  | 'Nhân sự cố định'
  | 'Điện nước & Vận hành'
  | 'Marketing & Khác';

export interface FixedCostItem {
  id: string;
  name: string;
  category: FixedCostCategory;
  monthlyAmount: number;
  active: boolean;
  note: string;
}

export interface OverheadConfig {
  projectedMonthlyUnits: number; // Sản lượng dự kiến / tháng (ly / phần)
  includeCcdcDepreciation: boolean; // Tự động cộng khấu hao CCDC từ bảng hàng hóa
  defaultTargetFoodCostPct: number; // % Food cost mục tiêu (e.g. 30)
  defaultPlatformFeePct: number; // % Phí sàn / Chiết khấu mặc định
}

export interface RecipeLineItem {
  id: string;
  catalogItemId: string;
  quantity: number;
}

export type OverheadAllocationMode = 'auto' | 'custom' | 'none';

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  category: string;
  sizeLabel: string;
  description: string;
  yieldCount: number; // Số phần / mẻ (Ingredients chia cho yieldCount; Bao bì tính theo 1 phần)
  ingredients: RecipeLineItem[];
  packaging: RecipeLineItem[];
  overheadMode: OverheadAllocationMode;
  customOverheadPerUnit: number;
  platformFeePct: number; // Chiết khấu sàn / App (%)
  sellingPrice: number;
  estimatedMonthlySales: number; // Sản lượng bán dự kiến / tháng cho món này
  isOnMenu: boolean;
}

export type WorkspaceTab = 'dashboard' | 'recipes' | 'catalog' | 'fixed-costs' | 'menu-board';
