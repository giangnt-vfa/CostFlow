import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  CatalogItem,
  FixedCostItem,
  MenuItem,
  OverheadConfig,
  RecipeLineItem,
} from '../types/costing';

export function sanitizeId(raw: string, fallbackPrefix = 'doc'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_${Date.now()}`;
}

function clampString(val: string | undefined, max: number, fallback = ''): string {
  const s = (val ?? fallback).trim();
  if (!s && fallback) return fallback.slice(0, max);
  return s.slice(0, max);
}

function clampNumber(val: number | undefined, min: number, max: number, fallback = min): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function sanitizeLineItems(items: RecipeLineItem[] | undefined, maxLen: number): RecipeLineItem[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, maxLen).map((l, idx) => ({
    id: sanitizeId(l.id || `line_${idx}`),
    catalogItemId: sanitizeId(l.catalogItemId),
    quantity: clampNumber(l.quantity, 0, 10000000, 0),
  }));
}

export function buildWorkspacePayload(
  ownerId: string,
  config: OverheadConfig,
  btpSeeded = true,
  isCreate = false
) {
  const base: Record<string, unknown> = {
    ownerId,
    projectedMonthlyUnits: clampNumber(config.projectedMonthlyUnits, 1, 10000000, 1800),
    includeCcdcDepreciation: Boolean(config.includeCcdcDepreciation),
    defaultTargetFoodCostPct: clampNumber(config.defaultTargetFoodCostPct, 1, 95, 30),
    defaultPlatformFeePct: clampNumber(config.defaultPlatformFeePct, 0, 80, 0),
    btpSeeded: Boolean(btpSeeded),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    base.createdAt = serverTimestamp();
  }
  return base;
}

export function buildCatalogPayload(
  ownerId: string,
  item: Omit<CatalogItem, 'id'>,
  isCreate = false
) {
  const isBtp = item.category === 'Bán thành phẩm';
  const prices = isBtp
    ? []
    : (item.purchasePrices || [])
        .map((p) => clampNumber(p, 0, 10000000000, 0))
        .filter((p) => p > 0)
        .slice(0, 9);

  const payload: Record<string, unknown> = {
    ownerId,
    checked: Boolean(item.checked),
    code: clampString(item.code, 40, 'SP001'),
    name: clampString(item.name, 200, 'Chưa đặt tên'),
    category: item.category,
    qcChan: clampNumber(item.qcChan, 0.0001, 1000000, 1),
    dvtChan: clampString(item.dvtChan, 40, 'Cái'),
    purchasePrices: prices,
    lossRate: clampNumber(item.lossRate, 0, 99, 0),
    qcLe: clampNumber(item.qcLe, 0.0001, 10000000, 1),
    dvtLe: clampString(item.dvtLe, 40, 'cái'),
    note: clampString(item.note, 500, ''),
    updatedAt: serverTimestamp(),
  };

  if (isBtp) {
    payload.subIngredients = sanitizeLineItems(item.subIngredients, 50);
  }
  if (typeof item.caloPerUnit === 'number' && Number.isFinite(item.caloPerUnit)) {
    payload.caloPerUnit = clampNumber(item.caloPerUnit, 0, 1000000, 0);
  }
  if (typeof item.caloPerRetailUnit === 'number' && Number.isFinite(item.caloPerRetailUnit)) {
    payload.caloPerRetailUnit = clampNumber(item.caloPerRetailUnit, 0, 1000000, 0);
  }
  if (
    item.category === 'Công cụ dụng cụ' &&
    typeof item.depreciationMonths === 'number' &&
    Number.isFinite(item.depreciationMonths)
  ) {
    payload.depreciationMonths = clampNumber(item.depreciationMonths, 1, 600, 12);
  }
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export function buildFixedCostPayload(
  ownerId: string,
  item: Omit<FixedCostItem, 'id'>,
  isCreate = false
) {
  const payload: Record<string, unknown> = {
    ownerId,
    name: clampString(item.name, 200, 'Khoản chi phí'),
    category: item.category,
    monthlyAmount: clampNumber(item.monthlyAmount, 0, 10000000000, 0),
    active: Boolean(item.active),
    note: clampString(item.note, 500, ''),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export function buildMenuItemPayload(
  ownerId: string,
  item: Omit<MenuItem, 'id'>,
  isCreate = false
) {
  const payload: Record<string, unknown> = {
    ownerId,
    code: clampString(item.code, 40, 'MN001'),
    name: clampString(item.name, 200, 'Món mới'),
    category: clampString(item.category, 100, 'Đồ uống'),
    sizeLabel: clampString(item.sizeLabel, 60, ''),
    description: clampString(item.description, 500, ''),
    yieldCount: clampNumber(item.yieldCount, 1, 10000, 1),
    ingredients: sanitizeLineItems(item.ingredients, 60),
    packaging: sanitizeLineItems(item.packaging, 30),
    overheadMode: item.overheadMode,
    customOverheadPerUnit: clampNumber(item.customOverheadPerUnit, 0, 100000000, 0),
    platformFeePct: clampNumber(item.platformFeePct, 0, 80, 0),
    sellingPrice: clampNumber(item.sellingPrice, 0, 1000000000, 0),
    estimatedMonthlySales: clampNumber(item.estimatedMonthlySales, 0, 10000000, 0),
    isOnMenu: Boolean(item.isOnMenu),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

export async function ensureUserWorkspaceSeeded(
  uid: string,
  seedData: {
    overheadConfig: OverheadConfig;
    catalog: CatalogItem[];
    fixedCosts: FixedCostItem[];
    menuItems: MenuItem[];
  }
): Promise<boolean> {
  if (!db) return false;
  const userPath = `users/${uid}`;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return false;
    }

    const batch = writeBatch(db);
    batch.set(userRef, buildWorkspacePayload(uid, seedData.overheadConfig, true, true));

    for (const item of seedData.catalog) {
      const id = sanitizeId(item.id);
      const { id: _ignore, ...rest } = item;
      batch.set(doc(db, 'users', uid, 'catalog', id), buildCatalogPayload(uid, rest, true));
    }

    for (const fc of seedData.fixedCosts) {
      const id = sanitizeId(fc.id);
      const { id: _ignore, ...rest } = fc;
      batch.set(doc(db, 'users', uid, 'fixedCosts', id), buildFixedCostPayload(uid, rest, true));
    }

    for (const menu of seedData.menuItems) {
      const id = sanitizeId(menu.id);
      const { id: _ignore, ...rest } = menu;
      batch.set(doc(db, 'users', uid, 'menuItems', id), buildMenuItemPayload(uid, rest, true));
    }

    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function replaceWorkspaceInFirestore(
  uid: string,
  existingIds: { catalogIds: string[]; fixedCostIds: string[]; menuIds: string[] },
  seedData: {
    overheadConfig: OverheadConfig;
    catalog: CatalogItem[];
    fixedCosts: FixedCostItem[];
    menuItems: MenuItem[];
  }
) {
  if (!db) return;
  const userPath = `users/${uid}`;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);

    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    if (snap.exists()) {
      const updateFields = buildWorkspacePayload(uid, seedData.overheadConfig, true, false);
      delete updateFields.ownerId;
      ops.push((b) => b.update(userRef, updateFields));
    } else {
      ops.push((b) => b.set(userRef, buildWorkspacePayload(uid, seedData.overheadConfig, true, true)));
    }

    for (const id of existingIds.catalogIds) {
      ops.push((b) => b.delete(doc(db!, 'users', uid, 'catalog', sanitizeId(id))));
    }
    for (const id of existingIds.fixedCostIds) {
      ops.push((b) => b.delete(doc(db!, 'users', uid, 'fixedCosts', sanitizeId(id))));
    }
    for (const id of existingIds.menuIds) {
      ops.push((b) => b.delete(doc(db!, 'users', uid, 'menuItems', sanitizeId(id))));
    }

    for (const item of seedData.catalog) {
      const id = sanitizeId(item.id);
      const { id: _ignore, ...rest } = item;
      ops.push((b) => b.set(doc(db!, 'users', uid, 'catalog', id), buildCatalogPayload(uid, rest, true)));
    }
    for (const fc of seedData.fixedCosts) {
      const id = sanitizeId(fc.id);
      const { id: _ignore, ...rest } = fc;
      ops.push((b) => b.set(doc(db!, 'users', uid, 'fixedCosts', id), buildFixedCostPayload(uid, rest, true)));
    }
    for (const menu of seedData.menuItems) {
      const id = sanitizeId(menu.id);
      const { id: _ignore, ...rest } = menu;
      ops.push((b) => b.set(doc(db!, 'users', uid, 'menuItems', id), buildMenuItemPayload(uid, rest, true)));
    }

    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const applyOp of ops.slice(i, i + CHUNK_SIZE)) {
        applyOp(batch);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export function subscribeToUserWorkspace(
  uid: string,
  callbacks: {
    onOverheadConfig: (config: OverheadConfig) => void;
    onCatalog: (items: CatalogItem[]) => void;
    onFixedCosts: (items: FixedCostItem[]) => void;
    onMenuItems: (items: MenuItem[]) => void;
    onError: (err: Error) => void;
  }
): () => void {
  if (!db) return () => {};

  const userPath = `users/${uid}`;
  const catalogPath = `users/${uid}/catalog`;
  const fixedCostsPath = `users/${uid}/fixedCosts`;
  const menuPath = `users/${uid}/menuItems`;

  const unsubUser = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      callbacks.onOverheadConfig({
        projectedMonthlyUnits: Number(d.projectedMonthlyUnits) || 1800,
        includeCcdcDepreciation: Boolean(d.includeCcdcDepreciation),
        defaultTargetFoodCostPct: Number(d.defaultTargetFoodCostPct) || 30,
        defaultPlatformFeePct: Number(d.defaultPlatformFeePct) || 0,
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, userPath);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    }
  );

  const unsubCatalog = onSnapshot(
    query(collection(db, catalogPath), where('ownerId', '==', uid)),
    (snap) => {
      const list: CatalogItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          checked: Boolean(d.checked),
          code: String(d.code || ''),
          name: String(d.name || ''),
          category: d.category,
          qcChan: Number(d.qcChan) || 1,
          dvtChan: String(d.dvtChan || 'Cái'),
          purchasePrices: Array.isArray(d.purchasePrices) ? d.purchasePrices.map(Number) : [],
          subIngredients: Array.isArray(d.subIngredients) ? d.subIngredients : undefined,
          lossRate: Number(d.lossRate) || 0,
          qcLe: Number(d.qcLe) || 1,
          dvtLe: String(d.dvtLe || 'cái'),
          caloPerUnit: typeof d.caloPerUnit === 'number' ? d.caloPerUnit : undefined,
          caloPerRetailUnit:
            typeof d.caloPerRetailUnit === 'number' ? d.caloPerRetailUnit : undefined,
          depreciationMonths:
            typeof d.depreciationMonths === 'number' ? d.depreciationMonths : undefined,
          note: String(d.note || ''),
        };
      });
      list.sort((a, b) => a.code.localeCompare(b.code));
      callbacks.onCatalog(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, catalogPath);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    }
  );

  const unsubFixed = onSnapshot(
    query(collection(db, fixedCostsPath), where('ownerId', '==', uid)),
    (snap) => {
      const list: FixedCostItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          name: String(d.name || ''),
          category: d.category,
          monthlyAmount: Number(d.monthlyAmount) || 0,
          active: Boolean(d.active),
          note: String(d.note || ''),
        };
      });
      callbacks.onFixedCosts(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, fixedCostsPath);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    }
  );

  const unsubMenu = onSnapshot(
    query(collection(db, menuPath), where('ownerId', '==', uid)),
    (snap) => {
      const list: MenuItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          code: String(d.code || ''),
          name: String(d.name || ''),
          category: String(d.category || ''),
          sizeLabel: String(d.sizeLabel || ''),
          description: String(d.description || ''),
          yieldCount: Number(d.yieldCount) || 1,
          ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
          packaging: Array.isArray(d.packaging) ? d.packaging : [],
          overheadMode: d.overheadMode || 'auto',
          customOverheadPerUnit: Number(d.customOverheadPerUnit) || 0,
          platformFeePct: Number(d.platformFeePct) || 0,
          sellingPrice: Number(d.sellingPrice) || 0,
          estimatedMonthlySales: Number(d.estimatedMonthlySales) || 0,
          isOnMenu: Boolean(d.isOnMenu),
        };
      });
      list.sort((a, b) => a.code.localeCompare(b.code));
      callbacks.onMenuItems(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, menuPath);
      } catch (wrapped) {
        callbacks.onError(wrapped as Error);
      }
    }
  );

  return () => {
    unsubUser();
    unsubCatalog();
    unsubFixed();
    unsubMenu();
  };
}

export async function firestoreCreateDoc(pathParts: string[], data: Record<string, unknown>) {
  if (!db) return;
  const path = pathParts.join('/');
  try {
    await setDoc(doc(db, path), data);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function firestoreUpdateDoc(pathParts: string[], data: Record<string, unknown>) {
  if (!db) return;
  const path = pathParts.join('/');
  try {
    await updateDoc(doc(db, path), data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function firestoreDeleteDoc(pathParts: string[]) {
  if (!db) return;
  const path = pathParts.join('/');
  try {
    await deleteDoc(doc(db, path));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
