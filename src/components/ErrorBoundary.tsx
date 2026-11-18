import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: raw };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Đã xảy ra lỗi đồng bộ dữ liệu
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Ứng dụng gặp lỗi khi truy cập cơ sở dữ liệu Firestore. Vui lòng kiểm tra kết nối mạng, quyền truy cập hoặc cấu hình Firebase.
            </p>
            <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono-num text-slate-700 overflow-x-auto max-h-40">
              {this.state.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
