export type ItemCategory =
  | 'Nguyên vật liệu'
  | 'Bán thành phẩm'
  | 'Bao bì'
  | 'Công cụ dụng cụ';

export interface CatalogItem {
  id: string;
  checked: boolean;
  code: string;
  name: string;
  category: ItemCategory;
  qcChan: number; // Quy cách chẵn (e.g. 15, 1, 1000)
  dvtChan: string; // ĐVT chẵn (e.g. Gói, Hộp, Thùng, Mẻ)
  purchasePrices: number[]; // Giá nhập 1..9
  subIngredients?: RecipeLineItem[]; // Thành phần cấu tạo khi category === 'Bán thành phẩm'
  lossRate: number; // Tỉ lệ hao hụt (%)
  qcLe: number; // Quy cách lẻ (e.g. 1000, 500, 1) hoặc sản lượng thu được của 1 mẻ BTP
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

export type OrderSource =
  | 'Zalo / Tin nhắn'
  | 'Facebook / Messenger'
  | 'Website đặt trực tiếp'
  | 'Khách quen / Hotline';

export type DeliveryZone =
  | 'Nội thành (<3km)'
  | 'Trung tâm (3–7km)'
  | 'Ngoại thành (>7km)';

export type CustomerSegment = 'new' | 'returning';

export type OrderStatus = 'completed' | 'cancelled';

export interface SalesOrderItem {
  menuItemId: string;
  code: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  unitCogs: number; // Giá vốn trực tiếp (NVL + Bao bì) tại thời điểm bán
}

export interface SalesOrder {
  id: string;
  orderCode: string;
  date: string; // YYYY-MM-DD
  source: OrderSource;
  deliveryZone: DeliveryZone;
  customerSegment: CustomerSegment;
  status: OrderStatus;
  items: SalesOrderItem[];
  discountAmount: number; // Khuyến mãi / Giảm giá đơn
  shippingFeeCollected: number; // Phí ship thu khách
  shippingCostActual: number; // Phí ship thực trả shipper (phần bù ship = max(0, actual - collected))
  note: string;
}

export type SalesTargetPeriod = 'day' | 'week' | 'month';
export type SalesTargetMode = 'profit' | 'units';

export interface SalesTargetConfig {
  period: SalesTargetPeriod;
  mode: SalesTargetMode;
  targetMonthlyProfit: number; // Lợi nhuận ròng mục tiêu quy đổi theo tháng (VNĐ)
  targetMonthlyUnits: number; // Sản lượng mục tiêu quy đổi theo tháng (phần/ly)
  estimatedAppCommissionPct: number; // % Chiết khấu sàn tham chiếu để tính tiền tiết kiệm (mặc định 25%)
}

export type WorkspaceTab =
  | 'dashboard'
  | 'sales'
  | 'recipes'
  | 'catalog'
  | 'fixed-costs'
  | 'menu-board';
