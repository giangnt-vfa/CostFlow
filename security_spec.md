# Security Specification: Con Bà Bảy Food Firestore Rules

## 1. Data Invariants
1. **Single-Tenant User Isolation**: Every workspace document (`/users/{userId}`) and subcollection record (`/catalog/{itemId}`, `/fixedCosts/{costId}`, `/menuItems/{menuId}`, `/salesOrders/{orderId}`) belongs strictly to `{userId}`.
2. **Verified Identity Mandate**: Unauthenticated users and unverified email accounts (`email_verified != true`) are denied all read/write access.
3. **Immutable Ownership & Timestamps**: `ownerId` and `createdAt` cannot change after document creation; `createdAt` and `updatedAt` must equal `request.time`.
4. **Master Gate Parent Link**: Every subcollection write (`catalog`, `fixedCosts`, `menuItems`, `salesOrders`) validates both path ownership (`request.auth.uid == userId`) and existence of the parent `/users/{userId}` workspace document on create.
5. **Bounded Arrays & Strict Keys**: Every document enforces exact `keys().hasAll(...)` and `keys().hasOnly(...)`, string length bounds, numeric ranges, and array size caps (`purchasePrices <= 9`, `subIngredients <= 50`, `ingredients <= 60`, `packaging <= 30`, `items <= 40`).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read/Write**: `auth = null` attempting `get(/users/u1/catalog/NVL001)` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Read/Write**: `auth.uid = 'attacker'` attempting `create/update/delete` on `/users/victim/salesOrders/ord1` -> `PERMISSION_DENIED`.
3. **Unverified Email Spoof**: `auth.uid = 'u1', email_verified = false` attempting `create` on `/users/u1` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: `create` on `/users/u1/salesOrders/ord1` with extra ghost field `isAdmin: true` -> `PERMISSION_DENIED`.
5. **OwnerId Spoofing on Create**: `auth.uid = 'u1'` creating `/users/u1/fixedCosts/f1` with `ownerId: 'u2'` -> `PERMISSION_DENIED`.
6. **Immutable OwnerId Mutation**: Updating `/users/u1/salesOrders/ord1` changing `ownerId` from `'u1'` to `'u2'` -> `PERMISSION_DENIED`.
7. **Client-Forged Timestamp**: Creating `/users/u1/catalog/c1` with client-supplied `createdAt` != `request.time` -> `PERMISSION_DENIED`.
8. **Path ID Poisoning**: Creating `/users/u1/salesOrders/bad@id!` or 200-char invalid ID -> `PERMISSION_DENIED`.
9. **Unbounded Array / Denial-of-Wallet**: Creating `SalesOrder` with `items` array of 55 entries (> 40) -> `PERMISSION_DENIED`.
10. **Invalid Enum / Date Format**: Creating `SalesOrder` with `source: 'HackApp'` or invalid `date: '2026/13/99'` -> `PERMISSION_DENIED`.
11. **Negative / Invalid Numeric Range**: Creating `SalesOrder` with `discountAmount: -5000` -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: `auth.uid = 'attacker'` running `list` on `/users/victim/salesOrders` -> `PERMISSION_DENIED`.
