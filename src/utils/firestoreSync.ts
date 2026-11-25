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
import { INITIAL_SALES_TARGET } from '../data/initialSalesData';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  CatalogItem,
  FixedCostItem,
  MenuItem,
  OverheadConfig,
  RecipeLineItem,
  SalesOrder,
  SalesOrderItem,
  SalesTargetConfig,
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

function sanitizeSalesOrderItems(items: SalesOrderItem[] | undefined): SalesOrderItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [
      {
        menuItemId: 'menu_1',
        code: 'MN001',
        name: 'Món bán',
        category: 'Khác',
        quantity: 1,
        unitPrice: 0,
        unitCogs: 0,
      },
    ];
  }
  return items.slice(0, 40).map((it, idx) => ({
    menuItemId: sanitizeId(it.menuItemId || `menu_${idx}`),
    code: clampString(it.code, 40, 'MN001'),
    name: clampString(it.name, 200, 'Món bán'),
    category: clampString(it.category, 100, 'Khác'),
    quantity: clampNumber(it.quantity, 1, 10000, 1),
    unitPrice: clampNumber(it.unitPrice, 0, 1000000000, 0),
    unitCogs: clampNumber(it.unitCogs, 0, 1000000000, 0),
  }));
}

export function buildWorkspacePayload(
  ownerId: string,
  config: OverheadConfig,
  btpSeeded = true,
  isCreate = false,
  salesTarget?: SalesTargetConfig
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
  if (salesTarget) {
    base.salesTargetPeriod =
      salesTarget.period === 'day' || salesTarget.period === 'week' || salesTarget.period === 'month'
        ? salesTarget.period
        : 'month';
    base.salesTargetMode = salesTarget.mode === 'units' ? 'units' : 'profit';
    base.salesTargetMonthlyProfit = clampNumber(
      salesTarget.targetMonthlyProfit,
      0,
      100000000000,
      20000000
    );
    base.salesTargetMonthlyUnits = clampNumber(salesTarget.targetMonthlyUnits, 1, 10000000, 1600);
    base.estimatedAppCommissionPct = clampNumber(
      salesTarget.estimatedAppCommissionPct,
      0,
      60,
      25
    );
  }
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

export function buildSalesOrderPayload(
  ownerId: string,
  order: Omit<SalesOrder, 'id'>,
  isCreate = false
) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(order.date)
    ? order.date
    : new Date().toISOString().slice(0, 10);

  const payload: Record<string, unknown> = {
    ownerId,
    orderCode: clampString(order.orderCode, 40, `DH-${Date.now().toString().slice(-5)}`),
    date: validDate,
    source: order.source,
    deliveryZone: order.deliveryZone,
    customerSegment: order.customerSegment === 'new' ? 'new' : 'returning',
    status: order.status === 'cancelled' ? 'cancelled' : 'completed',
    items: sanitizeSalesOrderItems(order.items),
    discountAmount: clampNumber(order.discountAmount, 0, 1000000000, 0),
    shippingFeeCollected: clampNumber(order.shippingFeeCollected, 0, 10000000, 0),
    shippingCostActual: clampNumber(order.shippingCostActual, 0, 10000000, 0),
    note: clampString(order.note, 500, ''),
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = error instanceof Error ? error.message : String(error);
  return (
    code === 'permission-denied' ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('PERMISSION_DENIED')
  );
}

/**
 * Firestore Security Rules cap `exists()`/`get()` calls at 20 per batched write.
 * Because subcollection `create` rules check `hasWorkspace(userId)` via `exists()`,
 * keep each batch <= 10 documents so we never hit the security rules access-call limit.
 */
async function commitChunkedOps(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  chunkSize = 10
) {
  if (!db || ops.length === 0) return;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = writeBatch(db);
    for (const applyOp of ops.slice(i, i + chunkSize)) {
      applyOp(batch);
    }
    await batch.commit();
  }
}

export interface WorkspaceSeedResult {
  seeded: boolean;
  salesRulesUpdateRequired?: boolean;
}

export async function ensureUserWorkspaceSeeded(
  uid: string,
  seedData: {
    overheadConfig: OverheadConfig;
    salesTarget: SalesTargetConfig;
    catalog: CatalogItem[];
    fixedCosts: FixedCostItem[];
    menuItems: MenuItem[];
    salesOrders: SalesOrder[];
  }
): Promise<WorkspaceSeedResult> {
  if (!db) return { seeded: false };
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (snap.exists()) {
    const existingData = snap.data();
    // One-time upgrade for existing workspaces that don't yet have salesTarget / salesOrders
    if (!('salesTargetPeriod' in existingData)) {
      try {
        const updateFields = buildWorkspacePayload(
          uid,
          seedData.overheadConfig,
          true,
          false,
          seedData.salesTarget
        );
        delete updateFields.ownerId;
        await updateDoc(userRef, updateFields);

        const salesOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
        for (const order of seedData.salesOrders) {
          const id = sanitizeId(order.id);
          const { id: _ignore, ...rest } = order;
          salesOps.push((b) =>
            b.set(
              doc(db!, 'users', uid, 'salesOrders', id),
              buildSalesOrderPayload(uid, rest, true)
            )
          );
        }
        await commitChunkedOps(salesOps, 10);
        return { seeded: true };
      } catch (error) {
        if (isPermissionDenied(error)) {
          // Existing workspace works on older firestore.rules; let catalog/menu/fixedCosts keep syncing
          // while prompting the user to publish the updated firestore.rules for salesOrders.
          return { seeded: false, salesRulesUpdateRequired: true };
        }
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }
    return { seeded: false };
  }

  // Brand-new workspace: create the root document FIRST so `exists(/users/{uid})` is true
  // before any subcollection creates run (avoids double exists/existsAfter calls in batches).
  try {
    await setDoc(
      userRef,
      buildWorkspacePayload(uid, seedData.overheadConfig, true, true, seedData.salesTarget)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }

  const coreOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const item of seedData.catalog) {
    const id = sanitizeId(item.id);
    const { id: _ignore, ...rest } = item;
    coreOps.push((b) =>
      b.set(doc(db!, 'users', uid, 'catalog', id), buildCatalogPayload(uid, rest, true))
    );
  }
  for (const fc of seedData.fixedCosts) {
    const id = sanitizeId(fc.id);
    const { id: _ignore, ...rest } = fc;
    coreOps.push((b) =>
      b.set(doc(db!, 'users', uid, 'fixedCosts', id), buildFixedCostPayload(uid, rest, true))
    );
  }
  for (const menu of seedData.menuItems) {
    const id = sanitizeId(menu.id);
    const { id: _ignore, ...rest } = menu;
    coreOps.push((b) =>
      b.set(doc(db!, 'users', uid, 'menuItems', id), buildMenuItemPayload(uid, rest, true))
    );
  }

  try {
    await commitChunkedOps(coreOps, 10);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  const salesOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const order of seedData.salesOrders) {
    const id = sanitizeId(order.id);
    const { id: _ignore, ...rest } = order;
    salesOps.push((b) =>
      b.set(doc(db!, 'users', uid, 'salesOrders', id), buildSalesOrderPayload(uid, rest, true))
    );
  }

  try {
    await commitChunkedOps(salesOps, 10);
  } catch (error) {
    if (isPermissionDenied(error)) {
      return { seeded: true, salesRulesUpdateRequired: true };
    }
    handleFirestoreError(error, OperationType.CREATE, `users/${uid}/salesOrders`);
  }

  return { seeded: true };
}

export async function replaceWorkspaceInFirestore(
  uid: string,
  existingIds: {
    catalogIds: string[];
    fixedCostIds: string[];
    menuIds: string[];
    salesOrderIds: string[];
  },
  seedData: {
    overheadConfig: OverheadConfig;
    salesTarget: SalesTargetConfig;
    catalog: CatalogItem[];
    fixedCosts: FixedCostItem[];
    menuItems: MenuItem[];
    salesOrders: SalesOrder[];
  }
) {
  if (!db) return;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);

    // 1. Update or create root workspace document FIRST
    if (snap.exists()) {
      const updateFields = buildWorkspacePayload(
        uid,
        seedData.overheadConfig,
        true,
        false,
        seedData.salesTarget
      );
      delete updateFields.ownerId;
      await updateDoc(userRef, updateFields);
    } else {
      await setDoc(
        userRef,
        buildWorkspacePayload(uid, seedData.overheadConfig, true, true, seedData.salesTarget)
      );
    }

    // 2. Delete stale subcollection docs (delete rules don't call exists(), so larger chunks are safe)
    const deleteOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    for (const id of existingIds.catalogIds) {
      deleteOps.push((b) => b.delete(doc(db!, 'users', uid, 'catalog', sanitizeId(id))));
    }
    for (const id of existingIds.fixedCostIds) {
      deleteOps.push((b) => b.delete(doc(db!, 'users', uid, 'fixedCosts', sanitizeId(id))));
    }
    for (const id of existingIds.menuIds) {
      deleteOps.push((b) => b.delete(doc(db!, 'users', uid, 'menuItems', sanitizeId(id))));
    }
    for (const id of existingIds.salesOrderIds) {
      deleteOps.push((b) => b.delete(doc(db!, 'users', uid, 'salesOrders', sanitizeId(id))));
    }
    await commitChunkedOps(deleteOps, 100);

    // 3. Re-create subcollection docs in chunks of 10 (respects 20 exists() calls/batch limit)
    const createOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    for (const item of seedData.catalog) {
      const id = sanitizeId(item.id);
      const { id: _ignore, ...rest } = item;
      createOps.push((b) =>
        b.set(doc(db!, 'users', uid, 'catalog', id), buildCatalogPayload(uid, rest, true))
      );
    }
    for (const fc of seedData.fixedCosts) {
      const id = sanitizeId(fc.id);
      const { id: _ignore, ...rest } = fc;
      createOps.push((b) =>
        b.set(doc(db!, 'users', uid, 'fixedCosts', id), buildFixedCostPayload(uid, rest, true))
      );
    }
    for (const menu of seedData.menuItems) {
      const id = sanitizeId(menu.id);
      const { id: _ignore, ...rest } = menu;
      createOps.push((b) =>
        b.set(doc(db!, 'users', uid, 'menuItems', id), buildMenuItemPayload(uid, rest, true))
      );
    }
    for (const order of seedData.salesOrders) {
      const id = sanitizeId(order.id);
      const { id: _ignore, ...rest } = order;
      createOps.push((b) =>
        b.set(doc(db!, 'users', uid, 'salesOrders', id), buildSalesOrderPayload(uid, rest, true))
      );
    }
    await commitChunkedOps(createOps, 10);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export function subscribeToUserWorkspace(
  uid: string,
  callbacks: {
    onWorkspaceSettings: (config: OverheadConfig, salesTarget?: SalesTargetConfig) => void;
    onCatalog: (items: CatalogItem[]) => void;
    onFixedCosts: (items: FixedCostItem[]) => void;
    onMenuItems: (items: MenuItem[]) => void;
    onSalesOrders: (orders: SalesOrder[]) => void;
    onSalesSyncError?: (err: Error) => void;
    skipSalesOrders?: boolean;
    onError: (err: Error) => void;
  }
): () => void {
  if (!db) return () => {};

  const userPath = `users/${uid}`;
  const catalogPath = `users/${uid}/catalog`;
  const fixedCostsPath = `users/${uid}/fixedCosts`;
  const menuPath = `users/${uid}/menuItems`;
  const salesOrdersPath = `users/${uid}/salesOrders`;

  const unsubUser = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const config: OverheadConfig = {
        projectedMonthlyUnits: Number(d.projectedMonthlyUnits) || 1800,
        includeCcdcDepreciation: Boolean(d.includeCcdcDepreciation),
        defaultTargetFoodCostPct: Number(d.defaultTargetFoodCostPct) || 30,
        defaultPlatformFeePct: Number(d.defaultPlatformFeePct) || 0,
      };
      const target: SalesTargetConfig | undefined =
        'salesTargetPeriod' in d || 'salesTargetMonthlyProfit' in d
          ? {
              period:
                d.salesTargetPeriod === 'day' ||
                d.salesTargetPeriod === 'week' ||
                d.salesTargetPeriod === 'month'
                  ? d.salesTargetPeriod
                  : INITIAL_SALES_TARGET.period,
              mode: d.salesTargetMode === 'units' ? 'units' : 'profit',
              targetMonthlyProfit:
                typeof d.salesTargetMonthlyProfit === 'number'
                  ? d.salesTargetMonthlyProfit
                  : INITIAL_SALES_TARGET.targetMonthlyProfit,
              targetMonthlyUnits:
                typeof d.salesTargetMonthlyUnits === 'number'
                  ? d.salesTargetMonthlyUnits
                  : INITIAL_SALES_TARGET.targetMonthlyUnits,
              estimatedAppCommissionPct:
                typeof d.estimatedAppCommissionPct === 'number'
                  ? d.estimatedAppCommissionPct
                  : INITIAL_SALES_TARGET.estimatedAppCommissionPct,
            }
          : undefined;
      callbacks.onWorkspaceSettings(config, target);
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

  const unsubSales = callbacks.skipSalesOrders
    ? () => {}
    : onSnapshot(
        query(collection(db, salesOrdersPath), where('ownerId', '==', uid)),
        (snap) => {
          const list: SalesOrder[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              orderCode: String(d.orderCode || docSnap.id),
              date: String(d.date || ''),
              source: d.source,
              deliveryZone: d.deliveryZone,
              customerSegment: d.customerSegment === 'new' ? 'new' : 'returning',
              status: d.status === 'cancelled' ? 'cancelled' : 'completed',
              items: Array.isArray(d.items) ? d.items : [],
              discountAmount: Number(d.discountAmount) || 0,
              shippingFeeCollected: Number(d.shippingFeeCollected) || 0,
              shippingCostActual: Number(d.shippingCostActual) || 0,
              note: String(d.note || ''),
            };
          });
          list.sort((a, b) => b.date.localeCompare(a.date) || b.orderCode.localeCompare(a.orderCode));
          callbacks.onSalesOrders(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, salesOrdersPath);
          } catch (wrapped) {
            if (callbacks.onSalesSyncError) {
              callbacks.onSalesSyncError(wrapped as Error);
            } else {
              callbacks.onError(wrapped as Error);
            }
          }
        }
      );

  return () => {
    unsubUser();
    unsubCatalog();
    unsubFixed();
    unsubMenu();
    unsubSales();
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
