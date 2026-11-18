import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  Menu as MenuIcon,
  Package,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { WorkspaceTab } from '../types/costing';
import { formatVND } from '../utils/formatters';

interface LayoutProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onCreateNewDish: () => void;
  onResetData: () => void;
  totalMonthlyOverhead: number;
  overheadPerUnit: number;
  menuCount: number;
  catalogCount: number;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  breadcrumb: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'dashboard',
    label: 'Tổng quan giá thành',
    breadcrumb: 'Bảng điều khiển / Tổng quan giá thành',
    icon: BarChart3,
  },
  {
    id: 'recipes',
    label: 'Định lượng & Tính giá',
    breadcrumb: 'Công thức / Định lượng & Tính giá thành',
    icon: Calculator,
  },
  {
    id: 'catalog',
    label: 'Nguyên liệu & Bao bì',
    breadcrumb: 'Kho dữ liệu / Nguyên vật liệu, Bao bì & CCDC',
    icon: Package,
  },
  {
    id: 'fixed-costs',
    label: 'Chi phí cố định & MB',
    breadcrumb: 'Vận hành / Chi phí cố định & Mặt bằng',
    icon: Building2,
  },
  {
    id: 'menu-board',
    label: 'Quản lý trang Menu',
    breadcrumb: 'Kinh doanh / Quản lý trang Menu món',
    icon: BookOpen,
  },
];

export function Layout({
  activeTab,
  onSelectTab,
  onCreateNewDish,
  onResetData,
  totalMonthlyOverhead,
  overheadPerUnit,
  menuCount,
  catalogCount,
  children,
}: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) || NAV_ITEMS[0];

  const handleNavClick = (id: WorkspaceTab) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            CostFlow F&amp;B
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Điều hướng chính">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                  isActive
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-teal-700' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>Tổng cố định / tháng</span>
              <span className="font-mono-num font-semibold text-slate-900">
                {formatVND(totalMonthlyOverhead)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Phân bổ / sản phẩm</span>
              <span className="font-mono-num font-semibold text-teal-700">
                {formatVND(overheadPerUnit)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500 pt-1">
              <span>{menuCount} món</span>
              <span>{catalogCount} mã hàng</span>
            </div>
          </div>

          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục dữ liệu mẫu</span>
            </button>
          ) : (
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <p className="text-xs text-slate-700 leading-snug">
                Đưa toàn bộ dữ liệu về bảng Excel mẫu ban đầu?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetData();
                    setConfirmReset(false);
                  }}
                  className="flex-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 whitespace-nowrap"
                >
                  Xác nhận
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 px-2.5 py-1.5 text-xs font-medium bg-white text-slate-700 border border-slate-200 rounded-md hover:bg-slate-100 whitespace-nowrap"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
              <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                CostFlow F&amp;B
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Đóng menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-teal-50 text-teal-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-teal-700' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary CTA on right */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Mở điều hướng"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-500 truncate">
              {currentNav.breadcrumb}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onCreateNewDish}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Tạo món mới</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
