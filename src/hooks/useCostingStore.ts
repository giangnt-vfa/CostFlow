import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  INITIAL_CATALOG,
  INITIAL_FIXED_COSTS,
  INITIAL_MENU_ITEMS,
  INITIAL_OVERHEAD_CONFIG,
} from '../data/initialData';
import { CatalogItem, FixedCostItem, MenuItem, OverheadConfig } from '../types/costing';
import { computeMonthlyOverheadTotal } from '../utils/formatters';

const STORAGE_KEY = 'costflow_fb_workspace_v1';

interface StoredWorkspace {
  catalog: CatalogItem[];
  fixedCosts: FixedCostItem[];
  overheadConfig: OverheadConfig;
  menuItems: MenuItem[];
}

function loadWorkspace(): StoredWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        catalog: INITIAL_CATALOG,
        fixedCosts: INITIAL_FIXED_COSTS,
        overheadConfig: INITIAL_OVERHEAD_CONFIG,
        menuItems: INITIAL_MENU_ITEMS,
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    return {
      catalog: Array.isArray(parsed.catalog) && parsed.catalog.length > 0 ? parsed.catalog : INITIAL_CATALOG,
      fixedCosts: Array.isArray(parsed.fixedCosts) ? parsed.fixedCosts : INITIAL_FIXED_COSTS,
      overheadConfig: parsed.overheadConfig
        ? { ...INITIAL_OVERHEAD_CONFIG, ...parsed.overheadConfig }
        : INITIAL_OVERHEAD_CONFIG,
      menuItems: Array.isArray(parsed.menuItems) ? parsed.menuItems : INITIAL_MENU_ITEMS,
    };
  } catch {
    return {
      catalog: INITIAL_CATALOG,
      fixedCosts: INITIAL_FIXED_COSTS,
      overheadConfig: INITIAL_OVERHEAD_CONFIG,
      menuItems: INITIAL_MENU_ITEMS,
    };
  }
}

export function useCostingStore() {
  const [workspace, setWorkspace] = useState<StoredWorkspace>(() => loadWorkspace());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }, [workspace]);

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
  const addCatalogItem = useCallback((item: Omit<CatalogItem, 'id'>) => {
    const newItem: CatalogItem = {
      ...item,
      id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    setWorkspace((prev) => ({
      ...prev,
      catalog: [newItem, ...prev.catalog],
    }));
    return newItem;
  }, []);

  const updateCatalogItem = useCallback((id: string, patch: Partial<CatalogItem>) => {
    setWorkspace((prev) => ({
      ...prev,
      catalog: prev.catalog.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }, []);

  const deleteCatalogItem = useCallback((id: string) => {
    setWorkspace((prev) => ({
      ...prev,
      catalog: prev.catalog.filter((item) => item.id !== id),
      menuItems: prev.menuItems.map((m) => ({
        ...m,
        ingredients: m.ingredients.filter((l) => l.catalogItemId !== id),
        packaging: m.packaging.filter((l) => l.catalogItemId !== id),
      })),
    }));
  }, []);

  const importCatalogItems = useCallback((items: CatalogItem[], mode: 'merge' | 'replace') => {
    setWorkspace((prev) => {
      if (mode === 'replace') {
        return { ...prev, catalog: items };
      }
      const existingByCode = new Map(prev.catalog.map((c) => [c.code.toUpperCase(), c]));
      for (const incoming of items) {
        const key = incoming.code.toUpperCase();
        const existing = existingByCode.get(key);
        if (existing) {
          existingByCode.set(key, { ...incoming, id: existing.id });
        } else {
          existingByCode.set(key, incoming);
        }
      }
      return { ...prev, catalog: Array.from(existingByCode.values()) };
    });
  }, []);

  // Fixed Costs CRUD
  const addFixedCost = useCallback((item: Omit<FixedCostItem, 'id'>) => {
    const newItem: FixedCostItem = {
      ...item,
      id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    setWorkspace((prev) => ({
      ...prev,
      fixedCosts: [...prev.fixedCosts, newItem],
    }));
  }, []);

  const updateFixedCost = useCallback((id: string, patch: Partial<FixedCostItem>) => {
    setWorkspace((prev) => ({
      ...prev,
      fixedCosts: prev.fixedCosts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  const deleteFixedCost = useCallback((id: string) => {
    setWorkspace((prev) => ({
      ...prev,
      fixedCosts: prev.fixedCosts.filter((c) => c.id !== id),
    }));
  }, []);

  const updateOverheadConfig = useCallback((patch: Partial<OverheadConfig>) => {
    setWorkspace((prev) => ({
      ...prev,
      overheadConfig: { ...prev.overheadConfig, ...patch },
    }));
  }, []);

  // Menu Items CRUD
  const addMenuItem = useCallback((item: Omit<MenuItem, 'id'>) => {
    const newItem: MenuItem = {
      ...item,
      id: `menu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    setWorkspace((prev) => ({
      ...prev,
      menuItems: [newItem, ...prev.menuItems],
    }));
    return newItem;
  }, []);

  const updateMenuItem = useCallback((id: string, patch: Partial<MenuItem>) => {
    setWorkspace((prev) => ({
      ...prev,
      menuItems: prev.menuItems.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }, []);

  const duplicateMenuItem = useCallback(
    (id: string) => {
      const source = workspace.menuItems.find((m) => m.id === id);
      if (!source) return '';
      const createdId = `menu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const copy: MenuItem = {
        ...source,
        id: createdId,
        code: `${source.code}-COPY`,
        name: `${source.name} (Bản sao)`,
        ingredients: source.ingredients.map((l) => ({
          ...l,
          id: `ing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        })),
        packaging: source.packaging.map((l) => ({
          ...l,
          id: `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        })),
      };
      setWorkspace((prev) => ({
        ...prev,
        menuItems: [copy, ...prev.menuItems],
      }));
      return createdId;
    },
    [workspace.menuItems]
  );

  const deleteMenuItem = useCallback((id: string) => {
    setWorkspace((prev) => ({
      ...prev,
      menuItems: prev.menuItems.filter((m) => m.id !== id),
    }));
  }, []);

  const resetToDefaultData = useCallback(() => {
    const fresh: StoredWorkspace = {
      catalog: INITIAL_CATALOG,
      fixedCosts: INITIAL_FIXED_COSTS,
      overheadConfig: INITIAL_OVERHEAD_CONFIG,
      menuItems: INITIAL_MENU_ITEMS,
    };
    setWorkspace(fresh);
  }, []);

  return {
    catalog: workspace.catalog,
    catalogMap,
    fixedCosts: workspace.fixedCosts,
    overheadConfig: workspace.overheadConfig,
    overheadSummary,
    menuItems: workspace.menuItems,
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
