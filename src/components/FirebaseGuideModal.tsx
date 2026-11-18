import React from 'react';
import { X } from 'lucide-react';

interface FirebaseGuideModalProps {
  open: boolean;
  onClose: () => void;
  isConfigured: boolean;
  projectId?: string | null;
  databaseId?: string;
}

export function FirebaseGuideModal({
  open,
  onClose,
  isConfigured,
  projectId,
  databaseId = '(default)',
}: FirebaseGuideModalProps) {
  if (!open) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Hướng dẫn kết nối &amp; đồng bộ dữ liệu Firebase
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
            aria-label="Đóng hướng dẫn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
            <div>
              Trạng thái hiện tại:{' '}
              <strong className="text-slate-900">
                {isConfigured
                  ? `Đã nhận cấu hình Firebase${projectId ? ` (dự án: ${projectId}, database: ${databaseId})` : ''}.`
                  : 'Chưa phát hiện biến môi trường Firebase — dữ liệu tạm lưu cục bộ trên trình duyệt.'}
              </strong>
            </div>
            {currentHost && (
              <div>
                Tên miền cần cấp phép (Authorized domain):{' '}
                <code className="font-mono-num bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-900">
                  {currentHost}
                </code>
              </div>
            )}
            {databaseId === 'default' && (
              <div className="pt-1 text-red-700 font-medium">
                Lưu ý: Biến <code className="font-mono-num bg-red-50 px-1 rounded">VITE_FIREBASE_DATABASE_ID</code> đang đặt là{' '}
                <code className="font-mono-num bg-red-50 px-1 rounded">&quot;default&quot;</code>. Cơ sở dữ liệu mặc định của Firestore có tên là{' '}
                <code className="font-mono-num bg-red-50 px-1 rounded">(default)</code> — hãy để trống biến này (<code className="font-mono-num bg-red-50 px-1 rounded">&quot;&quot;</code>) nếu bạn dùng database mặc định.
              </div>
            )}
          </div>

          <section className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Bước 1. Tạo dự án, Firestore Database &amp; bật Google Auth trên Firebase Console
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs sm:text-sm text-slate-600">
              <li>
                Truy cập <strong>console.firebase.google.com</strong> → mở dự án{' '}
                {projectId ? (
                  <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                    {projectId}
                  </code>
                ) : (
                  'Firebase của bạn'
                )}
                .
              </li>
              <li>
                Vào <strong>Firestore Database → Create database</strong> → chọn chế độ{' '}
                <strong>Production mode</strong> và tạo cơ sở dữ liệu{' '}
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  {databaseId}
                </code>{' '}
                (nếu bạn dùng tên database khác{' '}
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  (default)
                </code>
                , hãy điền tên đó vào biến{' '}
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  VITE_FIREBASE_DATABASE_ID
                </code>
                ).
              </li>
              <li>
                Vào <strong>Authentication → Sign-in method</strong> → bật nhà cung cấp{' '}
                <strong>Google</strong>.
              </li>
              <li>
                Trong <strong>Authentication → Settings → Authorized domains</strong>, thêm tên miền
                đang chạy (ví dụ{' '}
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  {currentHost || 'tên miền ứng dụng'}
                </code>
                ) để cửa sổ đăng nhập Google hoạt động.
              </li>
              <li>
                Vào <strong>Project Settings → General → Your apps</strong> → thêm ứng dụng Web (
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  &lt;/&gt;
                </code>
                ) để lấy bộ khóa{' '}
                <code className="font-mono-num text-xs bg-slate-100 px-1 py-0.5 rounded">
                  firebaseConfig
                </code>
                .
              </li>
            </ol>
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Bước 2. Thêm biến môi trường vào Secrets / tệp .env
            </h3>
            <p className="text-xs text-slate-600">
              Khai báo các biến sau trong bảng <strong>Secrets</strong> (hoặc tệp{' '}
              <code className="font-mono-num bg-slate-100 px-1 py-0.5 rounded">.env</code> theo mẫu{' '}
              <code className="font-mono-num bg-slate-100 px-1 py-0.5 rounded">.env.example</code>) rồi khởi động lại máy chủ dev:
            </p>
            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono-num overflow-x-auto">
{`VITE_FIREBASE_API_KEY="AIza..."
VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-project-id"
VITE_FIREBASE_STORAGE_BUCKET="your-project.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="1234567890"
VITE_FIREBASE_APP_ID="1:1234567890:web:abc..."
# Tùy chọn nếu dùng Firestore database ID khác '(default)'
VITE_FIREBASE_DATABASE_ID=""`}
            </pre>
          </section>

          <section className="space-y-2">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Bước 3. Cấu trúc dữ liệu &amp; Quy tắc bảo mật (firestore.rules)
            </h3>
            <p className="text-xs text-slate-600">
              Dữ liệu được phân tách theo từng tài khoản đăng nhập để đồng bộ đa thiết bị:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 font-mono-num">
              <li>/users/&#123;userId&#125; — Cấu hình phân bổ cố định &amp; thông số chung</li>
              <li>/users/&#123;userId&#125;/catalog/&#123;itemId&#125; — Nguyên vật liệu, Bán thành phẩm, Bao bì, CCDC</li>
              <li>/users/&#123;userId&#125;/fixedCosts/&#123;costId&#125; — Chi phí cố định &amp; mặt bằng</li>
              <li>/users/&#123;userId&#125;/menuItems/&#123;menuId&#125; — Món ăn, định lượng công thức &amp; giá bán</li>
            </ul>
            <p className="text-xs text-slate-600">
              Sao chép nội dung tệp <code className="font-mono-num bg-slate-100 px-1 py-0.5 rounded">firestore.rules</code> ở thư mục gốc vào mục{' '}
              <strong>Firestore Database → Rules</strong> và nhấn <strong>Publish</strong>.
            </p>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
