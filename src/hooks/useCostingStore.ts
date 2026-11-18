import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { serverTimestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INITIAL_CATALOG,
  INITIAL_FIXED_COSTS,
  INITIAL_MENU_ITEMS,
  INITIAL_OVERHEAD_CONFIG,
} from '../data/initialData';
import {
  auth,
  googleProvider,
  isFirebaseConfigured,
  resolvedFirebaseConfig,
  subscribeConnectionWarning,
  testConnection,
} from '../firebase';
import { CatalogItem, FixedCostItem, MenuItem, OverheadConfig } from '../types/costing';
import {
  buildCatalogPayload,
  buildFixedCostPayload,
  buildMenuItemPayload,
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
  btpSeeded?: boolean;
}

export type CloudSyncStatus = 'local' | 'connecting' | 'synced' | 'error';

function loadWorkspace(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        catalog: INITIAL_CATALOG,
        fixedCosts: INITIAL_FIXED_COSTS,
        overheadConfig: INITIAL_OVERHEAD_CONFIG,
        menuItems: INITIAL_MENU_ITEMS,
        btpSeeded: true,
      };
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

    return {
      catalog,
      fixedCosts: Array.isArray(parsed.fixedCosts) ? parsed.fixedCosts : INITIAL_FIXED_COSTS,
      overheadConfig: parsed.overheadConfig
        ? { ...INITIAL_OVERHEAD_CONFIG, ...parsed.overheadConfig }
        : INITIAL_OVERHEAD_CONFIG,
      menuItems,
      btpSeeded: true,
    };
  } catch {
    return {
      catalog: INITIAL_CATALOG,
      fixedCosts: INITIAL_FIXED_COSTS,
      overheadConfig: INITIAL_OVERHEAD_CONFIG,
      menuItems: INITIAL_MENU_ITEMS,
      btpSeeded: true,
    };
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
        await ensureUserWorkspaceSeeded(user.uid, {
          overheadConfig: workspaceRef.current.overheadConfig,
          catalog: workspaceRef.current.catalog,
          fixedCosts: workspaceRef.current.fixedCosts,
          menuItems: workspaceRef.current.menuItems,
        });

        if (cancelled) return;

        unsubFirestore = subscribeToUserWorkspace(user.uid, {
          onOverheadConfig: (config) => {
            setWorkspace((prev) => ({ ...prev, overheadConfig: config }));
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
          onError: (err) => {
            setSyncStatus('error');
            setSyncError(
              err.message.includes('Quota exceeded')
                ? 'Đã vượt hạn mức đọc/ghi miễn phí hôm nay của Firestore. Hạn mức sẽ tự đặt lại vào ngày mai.'
                : err.message
            );
          },
        });
      } catch (err) {
        if (cancelled) return;
        setSyncStatus('error');
        setSyncError(err instanceof Error ? err.message : String(err));
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
        },
        localSnapshot
      );
      setSyncStatus('synced');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : String(err));
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
        ).catch((err) => setSyncError(err instanceof Error ? err.message : String(err)));
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
          (err) => setSyncError(err instanceof Error ? err.message : String(err))
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
          setSyncError(err instanceof Error ? err.message : String(err))
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
          },
          {
            overheadConfig: workspaceRef.current.overheadConfig,
            catalog: nextCatalog,
            fixedCosts: workspaceRef.current.fixedCosts,
            menuItems: workspaceRef.current.menuItems,
          }
        ).catch((err) => setSyncError(err instanceof Error ? err.message : String(err)));
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
        ).catch((err) => setSyncError(err instanceof Error ? err.message : String(err)));
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
          (err) => setSyncError(err instanceof Error ? err.message : String(err))
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
          setSyncError(err instanceof Error ? err.message : String(err))
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
        const payload = buildWorkspacePayload(user.uid, merged, true, false);
        delete payload.ownerId;
        void firestoreUpdateDoc(['users', user.uid], payload).catch((err) =>
          setSyncError(err instanceof Error ? err.message : String(err))
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
        ).catch((err) => setSyncError(err instanceof Error ? err.message : String(err)));
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
          (err) => setSyncError(err instanceof Error ? err.message : String(err))
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
        ).catch((err) => setSyncError(err instanceof Error ? err.message : String(err)));
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
          setSyncError(err instanceof Error ? err.message : String(err))
        );
      }
    },
    [user]
  );

  const resetToDefaultData = useCallback(() => {
    const fresh: StoredWorkspace = {
      catalog: INITIAL_CATALOG,
      fixedCosts: INITIAL_FIXED_COSTS,
      overheadConfig: INITIAL_OVERHEAD_CONFIG,
      menuItems: INITIAL_MENU_ITEMS,
      btpSeeded: true,
    };
    const prevIds = {
      catalogIds: workspaceRef.current.catalog.map((c) => c.id),
      fixedCostIds: workspaceRef.current.fixedCosts.map((f) => f.id),
      menuIds: workspaceRef.current.menuItems.map((m) => m.id),
    };
    setWorkspace(fresh);
    if (user) {
      void replaceWorkspaceInFirestore(user.uid, prevIds, fresh).catch((err) =>
        setSyncError(err instanceof Error ? err.message : String(err))
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
    addMenuItem,
    updateMenuItem,
    duplicateMenuItem,
    deleteMenuItem,
    resetToDefaultData,
  };
}
