import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { serverTimestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INITIAL_CATALOG,
  INITIAL_FIXED_COSTS,
  INITIAL_MENU_ITEMS,
  INITIAL_OVERHEAD_CONFIG,
} from '../data/initialData';
import { INITIAL_SALES_TARGET, generateInitialSalesOrders } from '../data/initialSalesData';
import {
  auth,
  googleProvider,
  isFirebaseConfigured,
  resolvedFirebaseConfig,
  subscribeConnectionWarning,
  testConnection,
} from '../firebase';
import {
  CatalogItem,
  FixedCostItem,
  MenuItem,
  OverheadConfig,
  SalesOrder,
  SalesTargetConfig,
} from '../types/costing';
import {
  buildCatalogPayload,
  buildFixedCostPayload,
  buildMenuItemPayload,
  buildSalesOrderPayload,
  buildWorkspacePayload,
  ensureUserWorkspaceSeeded,
  firestoreCreateDoc,
  firestoreDeleteDoc,
  firestoreUpdateDoc,
  replaceWorkspaceInFirestore,
  sanitizeId,
  subscribeToUserWorkspace,
} from '../utils/firestoreSync';
import { computeMonthlyOverheadTotal } from '../utils/formatters';

const STORAGE_KEY = 'costflow_fb_workspace_v1';

interface StoredWorkspace {
  catalog: CatalogItem[];
  fixedCosts: FixedCostItem[];
  overheadConfig: OverheadConfig;
  menuItems: MenuItem[];
  salesOrders: SalesOrder[];
  salesTarget: SalesTargetConfig;
  btpSeeded?: boolean;
  salesSeeded?: boolean;
}

export type CloudSyncStatus = 'local' | 'connecting' | 'synced' | 'error';

const RULES_PUBLISH_MESSAGE =
  'Firestore từ chối quyền truy cập (Missing or insufficient permissions). Hãy bấm "Xem hướng dẫn" → sao chép toàn bộ firestore.rules mới nhất vào Firebase Console → Firestore Database → Rules và bấm Publish, sau đó nhấn "Thử kết nối lại".';

const SALES_RULES_UPGRADE_MESSAGE =
  'Dữ liệu công thức & nguyên liệu đã đồng bộ, nhưng tab Doanh thu bán hàng cần cập nhật firestore.rules mới (bổ sung bảng salesOrders & mục tiêu doanh thu). Hãy bấm "Xem hướng dẫn" để sao chép firestore.rules mới vào Firebase Console → Firestore Database → Rules → Publish rồi nhấn "Thử kết nối lại".';

function formatSyncErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Quota exceeded')) {
    return 'Đã vượt hạn mức đọc/ghi miễn phí hôm nay của Firestore. Hạn mức sẽ tự đặt lại vào ngày mai.';
  }
  if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
    return RULES_PUBLISH_MESSAGE;
  }
  return msg;
}

function buildDefaultWorkspace(): StoredWorkspace {
  const catMap = new Map(INITIAL_CATALOG.map((c) => [c.id, c]));
  return {
    catalog: INITIAL_CATALOG,
    fixedCosts: INITIAL_FIXED_COSTS,
    overheadConfig: INITIAL_OVERHEAD_CONFIG,
    menuItems: INITIAL_MENU_ITEMS,
    salesOrders: generateInitialSalesOrders(INITIAL_MENU_ITEMS, catMap),
    salesTarget: INITIAL_SALES_TARGET,
    btpSeeded: true,
    salesSeeded: true,
  };
}

function loadWorkspace(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildDefaultWorkspace();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    let catalog =
      Array.isArray(parsed.catalog) && parsed.catalog.length > 0 ? parsed.catalog : INITIAL_CATALOG;
    let menuItems = Array.isArray(parsed.menuItems) ? parsed.menuItems : INITIAL_MENU_ITEMS;

    if (!parsed.btpSeeded && !catalog.some((c) => c.category === 'Bán thành phẩm')) {
      const existingIds = new Set(catalog.map((c) => c.id));
      const newItems = INITIAL_CATALOG.filter(
        (c) =>
          (c.id === 'cat_NVL027' || c.category === 'Bán thành phẩm') &&
          !existingIds.has(c.id)
      );
      catalog = [...catalog, ...newItems];

      const existingMenuIds = new Set(menuItems.map((m) => m.id));
      const sampleMenu = INITIAL_MENU_ITEMS.find((m) => m.id === 'menu_6');
      if (sampleMenu && !existingMenuIds.has(sampleMenu.id)) {
        menuItems = [...menuItems, sampleMenu];
      }
    }

    const catMap = new Map(catalog.map((c) => [c.id, c]));
    const salesOrders =
      Array.isArray(parsed.salesOrders) && (parsed.salesSeeded || parsed.salesOrders.length > 0)
        ? parsed.salesOrders
        : generateInitialSalesOrders(menuItems, catMap);

    const salesTarget: SalesTargetConfig = parsed.salesTarget
      ? { ...INITIAL_SALES_TARGET, ...parsed.salesTarget }
      : INITIAL_SALES_TARGET;

    return {
      catalog,
      fixedCosts: Array.isArray(parsed.fixedCosts) ? parsed.fixedCosts : INITIAL_FIXED_COSTS,
      overheadConfig: parsed.overheadConfig
        ? { ...INITIAL_OVERHEAD_CONFIG, ...parsed.overheadConfig }
        : INITIAL_OVERHEAD_CONFIG,
      menuItems,
      salesOrders,
      salesTarget,
      btpSeeded: true,
      salesSeeded: true,
    };
  } catch {
    return buildDefaultWorkspace();
  }
}

export function useCostingStore() {
  const [workspace, setWorkspace] = useState<StoredWorkspace>(() => loadWorkspace());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(!isFirebaseConfigured);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncRetryNonce, setSyncRetryNonce] = useState(0);

  // Persist local cache
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // Ignore storage quota errors
    }
  }, [workspace]);

  // Firebase connection health warning (e.g. Firestore DB not created yet)
  useEffect(() => {
    return subscribeConnectionWarning((warning) => {
      if (warning) {
        setSyncError((prev) => prev || warning);
      }
    });
  }, []);

  // Firebase Auth listener
  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      setSyncStatus('local');
      return;
    }
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setSyncStatus('local');
      }
    });
    return () => unsub();
  }, []);

  // Firestore real-time subscription (ONLY when authReady && user)
  useEffect(() => {
    if (!authReady || !user || !isFirebaseConfigured) return;

    let cancelled = false;
    let unsubFirestore: (() => void) | null = null;

    setSyncStatus('connecting');
    setSyncError(null);

    const initAndSubscribe = async () => {
      try {
        const seedResult = await ensureUserWorkspaceSeeded(user.uid, {
          overheadConfig: workspaceRef.current.overheadConfig,
          salesTarget: workspaceRef.current.salesTarget,
          catalog: workspaceRef.current.catalog,
          fixedCosts: workspaceRef.current.fixedCosts,
          menuItems: workspaceRef.current.menuItems,
          salesOrders: workspaceRef.current.salesOrders,
        });

        if (cancelled) return;

        if (seedResult.salesRulesUpdateRequired) {
          setSyncError(SALES_RULES_UPGRADE_MESSAGE);
        }

        unsubFirestore = subscribeToUserWorkspace(user.uid, {
          skipSalesOrders: Boolean(seedResult.salesRulesUpdateRequired),
          onWorkspaceSettings: (config, target) => {
            setWorkspace((prev) => ({
              ...prev,
              overheadConfig: config,
              salesTarget: target ? { ...prev.salesTarget, ...target } : prev.salesTarget,
            }));
            setSyncStatus('synced');
          },
          onCatalog: (catalog) => {
            setWorkspace((prev) => ({ ...prev, catalog }));
            setSyncStatus('synced');
          },
          onFixedCosts: (fixedCosts) => {
            setWorkspace((prev) => ({ ...prev, fixedCosts }));
            setSyncStatus('synced');
          },
          onMenuItems: (menuItems) => {
            setWorkspace((prev) => ({ ...prev, menuItems }));
            setSyncStatus('synced');
          },
          onSalesOrders: (salesOrders) => {
            setWorkspace((prev) => ({ ...prev, salesOrders, salesSeeded: true }));
            setSyncStatus('synced');
          },
          onSalesSyncError: (err) => {
            const msg = err.message;
            if (
              msg.includes('Missing or insufficient permissions') ||
              msg.includes('PERMISSION_DENIED')
            ) {
              setSyncError(SALES_RULES_UPGRADE_MESSAGE);
            } else {
              setSyncError(formatSyncErrorMessage(err));
            }
          },
          onError: (err) => {
            setSyncStatus('error');
            setSyncError(formatSyncErrorMessage(err));
          },
        });
      } catch (err) {
        if (cancelled) return;
        setSyncStatus('error');
        setSyncError(formatSyncErrorMessage(err));
      }
    };

    void initAndSubscribe();

    return () => {
      cancelled = true;
      if (unsubFirestore) unsubFirestore();
    };
  }, [authReady, user, syncRetryNonce]);

  const retryCloudSync = useCallback(async () => {
    setSyncError(null);
    await testConnection();
    setSyncRetryNonce((n) => n + 1);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!auth || !googleProvider) return;
    setSyncError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setSyncError(
          `Tên miền "${host}" chưa được thêm vào Authorized domains trong Firebase Authentication → Settings.`
        );
      } else if (code === 'auth/operation-not-allowed') {
        setSyncError('Bạn chưa bật nhà cung cấp Google trong Firebase Authentication → Sign-in method.');
      } else if (code === 'auth/popup-blocked') {
        setSyncError('Trình duyệt đang chặn cửa sổ bật lên (Popup) đăng nhập Google. Hãy cho phép Popup và thử lại.');
      } else if (code !== 'auth/popup-closed-by-user') {
        setSyncError(err instanceof Error ? err.message : 'Đăng nhập Google thất bại.');
      }
    }
  }, []);

  const signOutUser = useCallback(async () => {
    if (!auth) return;
    await signOut(auth);
    setSyncStatus('local');
    setSyncError(null);
  }, []);

  const syncLocalDataToCloud = useCallback(async () => {
    if (!user) return;
    const localSnapshot = loadWorkspace();
    setSyncStatus('connecting');
    try {
      await replaceWorkspaceInFirestore(
        user.uid,
        {
          catalogIds: workspaceRef.current.catalog.map((c) => c.id),
          fixedCostIds: workspaceRef.current.fixedCosts.map((f) => f.id),
          menuIds: workspaceRef.current.menuItems.map((m) => m.id),
          salesOrderIds: workspaceRef.current.salesOrders.map((o) => o.id),
        },
        localSnapshot
      );
      setSyncStatus('synced');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(formatSyncErrorMessage(err));
    }
  }, [user]);

  const catalogMap = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of workspace.catalog) {
      map.set(item.id, item);
    }
    return map;
  }, [workspace.catalog]);

  const overheadSummary = useMemo(
    () =>
      computeMonthlyOverheadTotal(
        workspace.fixedCosts,
        workspace.catalog,
        workspace.overheadConfig
      ),
    [workspace.fixedCosts, workspace.catalog, workspace.overheadConfig]
  );

  // Catalog CRUD
  const addCatalogItem = useCallback(
    (item: Omit<CatalogItem, 'id'>) => {
      const id = sanitizeId(`cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const newItem: CatalogItem = { ...item, id };
      setWorkspace((prev) => ({
        ...prev,
        catalog: [newItem, ...prev.catalog],
      }));
      if (user) {
        void firestoreCreateDoc(
          ['users', user.uid, 'catalog', id],
          buildCatalogPayload(user.uid, item, true)
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
      return newItem;
    },
    [user]
  );

  const updateCatalogItem = useCallback(
    (id: string, patch: Partial<CatalogItem>) => {
      const existing = workspaceRef.current.catalog.find((c) => c.id === id);
      if (!existing) return;
      const merged: CatalogItem = { ...existing, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        catalog: prev.catalog.map((item) => (item.id === id ? merged : item)),
      }));
      if (user) {
        const { id: _ignore, ...rest } = merged;
        const payload = buildCatalogPayload(user.uid, rest, false);
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid, 'catalog', sanitizeId(id)], payload).catch(
          (err) => setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const deleteCatalogItem = useCallback(
    (id: string) => {
      const affectedBtps = workspaceRef.current.catalog.filter(
        (item) =>
          item.id !== id && item.subIngredients?.some((l) => l.catalogItemId === id)
      );
      const affectedMenus = workspaceRef.current.menuItems.filter(
        (m) =>
          m.ingredients.some((l) => l.catalogItemId === id) ||
          m.packaging.some((l) => l.catalogItemId === id)
      );

      setWorkspace((prev) => ({
        ...prev,
        catalog: prev.catalog
          .filter((item) => item.id !== id)
          .map((item) =>
            item.subIngredients
              ? {
                  ...item,
                  subIngredients: item.subIngredients.filter((l) => l.catalogItemId !== id),
                }
              : item
          ),
        menuItems: prev.menuItems.map((m) => ({
          ...m,
          ingredients: m.ingredients.filter((l) => l.catalogItemId !== id),
          packaging: m.packaging.filter((l) => l.catalogItemId !== id),
        })),
      }));

      if (user) {
        void firestoreDeleteDoc(['users', user.uid, 'catalog', sanitizeId(id)]).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
        for (const btp of affectedBtps) {
          const nextSubs = (btp.subIngredients || []).filter((l) => l.catalogItemId !== id);
          void firestoreUpdateDoc(['users', user.uid, 'catalog', sanitizeId(btp.id)], {
            subIngredients: nextSubs,
            updatedAt: serverTimestamp(),
          });
        }
        for (const m of affectedMenus) {
          void firestoreUpdateDoc(['users', user.uid, 'menuItems', sanitizeId(m.id)], {
            ingredients: m.ingredients.filter((l) => l.catalogItemId !== id),
            packaging: m.packaging.filter((l) => l.catalogItemId !== id),
            updatedAt: serverTimestamp(),
          });
        }
      }
    },
    [user]
  );

  const importCatalogItems = useCallback(
    (items: CatalogItem[], mode: 'merge' | 'replace') => {
      const prevCatalog = workspaceRef.current.catalog;
      let nextCatalog: CatalogItem[];

      if (mode === 'replace') {
        nextCatalog = items.map((it) => ({ ...it, id: sanitizeId(it.id) }));
      } else {
        const existingByCode = new Map(prevCatalog.map((c) => [c.code.toUpperCase(), c]));
        for (const incoming of items) {
          const key = incoming.code.toUpperCase();
          const existing = existingByCode.get(key);
          if (existing) {
            existingByCode.set(key, { ...incoming, id: existing.id });
          } else {
            existingByCode.set(key, { ...incoming, id: sanitizeId(incoming.id) });
          }
        }
        nextCatalog = Array.from(existingByCode.values());
      }

      setWorkspace((prev) => ({ ...prev, catalog: nextCatalog }));

      if (user) {
        void replaceWorkspaceInFirestore(
          user.uid,
          {
            catalogIds: prevCatalog.map((c) => c.id),
            fixedCostIds: workspaceRef.current.fixedCosts.map((f) => f.id),
            menuIds: workspaceRef.current.menuItems.map((m) => m.id),
            salesOrderIds: workspaceRef.current.salesOrders.map((o) => o.id),
          },
          {
            overheadConfig: workspaceRef.current.overheadConfig,
            salesTarget: workspaceRef.current.salesTarget,
            catalog: nextCatalog,
            fixedCosts: workspaceRef.current.fixedCosts,
            menuItems: workspaceRef.current.menuItems,
            salesOrders: workspaceRef.current.salesOrders,
          }
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
    },
    [user]
  );

  // Fixed Costs CRUD
  const addFixedCost = useCallback(
    (item: Omit<FixedCostItem, 'id'>) => {
      const id = sanitizeId(`fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const newItem: FixedCostItem = { ...item, id };
      setWorkspace((prev) => ({
        ...prev,
        fixedCosts: [...prev.fixedCosts, newItem],
      }));
      if (user) {
        void firestoreCreateDoc(
          ['users', user.uid, 'fixedCosts', id],
          buildFixedCostPayload(user.uid, item, true)
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
    },
    [user]
  );

  const updateFixedCost = useCallback(
    (id: string, patch: Partial<FixedCostItem>) => {
      const existing = workspaceRef.current.fixedCosts.find((c) => c.id === id);
      if (!existing) return;
      const merged: FixedCostItem = { ...existing, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        fixedCosts: prev.fixedCosts.map((c) => (c.id === id ? merged : c)),
      }));
      if (user) {
        const { id: _ignore, ...rest } = merged;
        const payload = buildFixedCostPayload(user.uid, rest, false);
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid, 'fixedCosts', sanitizeId(id)], payload).catch(
          (err) => setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const deleteFixedCost = useCallback(
    (id: string) => {
      setWorkspace((prev) => ({
        ...prev,
        fixedCosts: prev.fixedCosts.filter((c) => c.id !== id),
      }));
      if (user) {
        void firestoreDeleteDoc(['users', user.uid, 'fixedCosts', sanitizeId(id)]).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const updateOverheadConfig = useCallback(
    (patch: Partial<OverheadConfig>) => {
      const merged = { ...workspaceRef.current.overheadConfig, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        overheadConfig: merged,
      }));
      if (user) {
        const payload = buildWorkspacePayload(
          user.uid,
          merged,
          true,
          false,
          workspaceRef.current.salesTarget
        );
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid], payload).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const updateSalesTarget = useCallback(
    (patch: Partial<SalesTargetConfig>) => {
      const merged = { ...workspaceRef.current.salesTarget, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        salesTarget: merged,
      }));
      if (user) {
        const payload = buildWorkspacePayload(
          user.uid,
          workspaceRef.current.overheadConfig,
          true,
          false,
          merged
        );
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid], payload).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  // Menu Items CRUD
  const addMenuItem = useCallback(
    (item: Omit<MenuItem, 'id'>) => {
      const id = sanitizeId(`menu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const newItem: MenuItem = { ...item, id };
      setWorkspace((prev) => ({
        ...prev,
        menuItems: [newItem, ...prev.menuItems],
      }));
      if (user) {
        void firestoreCreateDoc(
          ['users', user.uid, 'menuItems', id],
          buildMenuItemPayload(user.uid, item, true)
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
      return newItem;
    },
    [user]
  );

  const updateMenuItem = useCallback(
    (id: string, patch: Partial<MenuItem>) => {
      const existing = workspaceRef.current.menuItems.find((m) => m.id === id);
      if (!existing) return;
      const merged: MenuItem = { ...existing, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        menuItems: prev.menuItems.map((m) => (m.id === id ? merged : m)),
      }));
      if (user) {
        const { id: _ignore, ...rest } = merged;
        const payload = buildMenuItemPayload(user.uid, rest, false);
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid, 'menuItems', sanitizeId(id)], payload).catch(
          (err) => setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const duplicateMenuItem = useCallback(
    (id: string) => {
      const source = workspaceRef.current.menuItems.find((m) => m.id === id);
      if (!source) return '';
      const createdId = sanitizeId(`menu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const copy: MenuItem = {
        ...source,
        id: createdId,
        code: `${source.code}-COPY`,
        name: `${source.name} (Bản sao)`,
        ingredients: source.ingredients.map((l) => ({
          ...l,
          id: sanitizeId(`ing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        })),
        packaging: source.packaging.map((l) => ({
          ...l,
          id: sanitizeId(`pkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        })),
      };
      setWorkspace((prev) => ({
        ...prev,
        menuItems: [copy, ...prev.menuItems],
      }));
      if (user) {
        const { id: _ignore, ...rest } = copy;
        void firestoreCreateDoc(
          ['users', user.uid, 'menuItems', createdId],
          buildMenuItemPayload(user.uid, rest, true)
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
      return createdId;
    },
    [user]
  );

  const deleteMenuItem = useCallback(
    (id: string) => {
      setWorkspace((prev) => ({
        ...prev,
        menuItems: prev.menuItems.filter((m) => m.id !== id),
      }));
      if (user) {
        void firestoreDeleteDoc(['users', user.uid, 'menuItems', sanitizeId(id)]).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  // Sales Orders CRUD
  const addSalesOrder = useCallback(
    (order: Omit<SalesOrder, 'id'>) => {
      const id = sanitizeId(`ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const created: SalesOrder = { ...order, id };
      setWorkspace((prev) => ({
        ...prev,
        salesOrders: [created, ...prev.salesOrders].sort(
          (a, b) => b.date.localeCompare(a.date) || b.orderCode.localeCompare(a.orderCode)
        ),
      }));
      if (user) {
        void firestoreCreateDoc(
          ['users', user.uid, 'salesOrders', id],
          buildSalesOrderPayload(user.uid, order, true)
        ).catch((err) => setSyncError(formatSyncErrorMessage(err)));
      }
      return created;
    },
    [user]
  );

  const updateSalesOrder = useCallback(
    (id: string, patch: Partial<SalesOrder>) => {
      const existing = workspaceRef.current.salesOrders.find((o) => o.id === id);
      if (!existing) return;
      const merged: SalesOrder = { ...existing, ...patch };
      setWorkspace((prev) => ({
        ...prev,
        salesOrders: prev.salesOrders
          .map((o) => (o.id === id ? merged : o))
          .sort((a, b) => b.date.localeCompare(a.date) || b.orderCode.localeCompare(a.orderCode)),
      }));
      if (user) {
        const { id: _ignore, ...rest } = merged;
        const payload = buildSalesOrderPayload(user.uid, rest, false);
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid, 'salesOrders', sanitizeId(id)], payload).catch(
          (err) => setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const deleteSalesOrder = useCallback(
    (id: string) => {
      setWorkspace((prev) => ({
        ...prev,
        salesOrders: prev.salesOrders.filter((o) => o.id !== id),
      }));
      if (user) {
        void firestoreDeleteDoc(['users', user.uid, 'salesOrders', sanitizeId(id)]).catch((err) =>
          setSyncError(formatSyncErrorMessage(err))
        );
      }
    },
    [user]
  );

  const resetToDefaultData = useCallback(() => {
    const fresh = buildDefaultWorkspace();
    const prevIds = {
      catalogIds: workspaceRef.current.catalog.map((c) => c.id),
      fixedCostIds: workspaceRef.current.fixedCosts.map((f) => f.id),
      menuIds: workspaceRef.current.menuItems.map((m) => m.id),
      salesOrderIds: workspaceRef.current.salesOrders.map((o) => o.id),
    };
    setWorkspace(fresh);
    if (user) {
      void replaceWorkspaceInFirestore(user.uid, prevIds, fresh).catch((err) =>
        setSyncError(formatSyncErrorMessage(err))
      );
    }
  }, [user]);

  return {
    catalog: workspace.catalog,
    catalogMap,
    fixedCosts: workspace.fixedCosts,
    overheadConfig: workspace.overheadConfig,
    overheadSummary,
    menuItems: workspace.menuItems,
    salesOrders: workspace.salesOrders,
    salesTarget: workspace.salesTarget,
    // Firebase auth & sync state
    isFirebaseConfigured,
    firebaseProjectId: resolvedFirebaseConfig?.projectId || null,
    firebaseDatabaseId: resolvedFirebaseConfig?.firestoreDatabaseId || '(default)',
    user,
    authReady,
    syncStatus,
    syncError,
    signInWithGoogle,
    signOutUser,
    syncLocalDataToCloud,
    retryCloudSync,
    // CRUD actions
    addCatalogItem,
    updateCatalogItem,
    deleteCatalogItem,
    importCatalogItems,
    addFixedCost,
    updateFixedCost,
    deleteFixedCost,
    updateOverheadConfig,
    updateSalesTarget,
    addMenuItem,
    updateMenuItem,
    duplicateMenuItem,
    deleteMenuItem,
    addSalesOrder,
    updateSalesOrder,
    deleteSalesOrder,
    resetToDefaultData,
  };
}
