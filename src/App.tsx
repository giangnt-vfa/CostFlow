/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { CatalogView } from './components/CatalogView';
import { DashboardView } from './components/DashboardView';
import { FirebaseGuideModal } from './components/FirebaseGuideModal';
import { FixedCostsView } from './components/FixedCostsView';
import { Layout } from './components/Layout';
import { MenuBoardView } from './components/MenuBoardView';
import { RecipeCostingView } from './components/RecipeCostingView';
import { useCostingStore } from './hooks/useCostingStore';
import { WorkspaceTab } from './types/costing';

export default function App() {
  const store = useCostingStore();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [firebaseGuideOpen, setFirebaseGuideOpen] = useState(false);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(
    () => store.menuItems[0]?.id ?? null
  );

  useEffect(() => {
    if (store.menuItems.length === 0) {
      if (selectedMenuId !== null) setSelectedMenuId(null);
      return;
    }
    if (!selectedMenuId || !store.menuItems.some((m) => m.id === selectedMenuId)) {
      setSelectedMenuId(store.menuItems[0].id);
    }
  }, [store.menuItems, selectedMenuId]);

  const handleOpenRecipe = (menuId: string) => {
    setSelectedMenuId(menuId);
    setActiveTab('recipes');
  };

  const handleCreateNewDish = () => {
    const nextNum = store.menuItems.length + 1;
    const created = store.addMenuItem({
      code: `MN${String(nextNum).padStart(3, '0')}`,
      name: `Món mới ${nextNum}`,
      category: 'Đồ uống đặc trưng',
      sizeLabel: '500ml',
      description: '',
      yieldCount: 1,
      ingredients: [],
      packaging: [],
      overheadMode: 'auto',
      customOverheadPerUnit: 0,
      platformFeePct: store.overheadConfig.defaultPlatformFeePct || 0,
      sellingPrice: 35000,
      estimatedMonthlySales: 150,
      isOnMenu: true,
    });
    setSelectedMenuId(created.id);
    setActiveTab('recipes');
  };

  const handleDuplicateDish = (id: string) => {
    const newId = store.duplicateMenuItem(id);
    if (newId) {
      setSelectedMenuId(newId);
    }
  };

  const handleDeleteDish = (id: string) => {
    const remaining = store.menuItems.filter((m) => m.id !== id);
    store.deleteMenuItem(id);
    if (selectedMenuId === id) {
      setSelectedMenuId(remaining[0]?.id ?? null);
    }
  };

  return (
    <>
      <Layout
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onCreateNewDish={handleCreateNewDish}
        onResetData={() => {
          store.resetToDefaultData();
          setSelectedMenuId('menu_1');
        }}
        totalMonthlyOverhead={store.overheadSummary.totalMonthlyOverhead}
        overheadPerUnit={store.overheadSummary.overheadPerUnit}
        menuCount={store.menuItems.length}
        catalogCount={store.catalog.length}
        isFirebaseConfigured={store.isFirebaseConfigured}
        user={store.user}
        syncStatus={store.syncStatus}
        syncError={store.syncError}
        onSignInGoogle={() => void store.signInWithGoogle()}
        onSignOut={() => void store.signOutUser()}
        onSyncLocalToCloud={() => void store.syncLocalDataToCloud()}
        onRetryCloudSync={() => void store.retryCloudSync()}
        onOpenFirebaseGuide={() => setFirebaseGuideOpen(true)}
      >
        {activeTab === 'dashboard' && (
          <DashboardView
            menuItems={store.menuItems}
            catalogMap={store.catalogMap}
            fixedCosts={store.fixedCosts}
            overheadConfig={store.overheadConfig}
            overheadSummary={store.overheadSummary}
            onOpenRecipe={handleOpenRecipe}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'recipes' && (
          <RecipeCostingView
            menuItems={store.menuItems}
            selectedMenuId={selectedMenuId}
            onSelectMenuId={setSelectedMenuId}
            catalog={store.catalog}
            catalogMap={store.catalogMap}
            overheadSummary={store.overheadSummary}
            overheadConfig={store.overheadConfig}
            onAddMenuItem={handleCreateNewDish}
            onUpdateMenuItem={store.updateMenuItem}
            onDuplicateMenuItem={handleDuplicateDish}
            onDeleteMenuItem={handleDeleteDish}
          />
        )}

        {activeTab === 'catalog' && (
          <CatalogView
            catalog={store.catalog}
            onAdd={store.addCatalogItem}
            onUpdate={store.updateCatalogItem}
            onDelete={store.deleteCatalogItem}
            onImport={store.importCatalogItems}
          />
        )}

        {activeTab === 'fixed-costs' && (
          <FixedCostsView
            fixedCosts={store.fixedCosts}
            catalog={store.catalog}
            overheadConfig={store.overheadConfig}
            overheadSummary={store.overheadSummary}
            onAddFixedCost={store.addFixedCost}
            onUpdateFixedCost={store.updateFixedCost}
            onDeleteFixedCost={store.deleteFixedCost}
            onUpdateOverheadConfig={store.updateOverheadConfig}
          />
        )}

        {activeTab === 'menu-board' && (
          <MenuBoardView
            menuItems={store.menuItems}
            catalogMap={store.catalogMap}
            overheadPerUnit={store.overheadSummary.overheadPerUnit}
            onUpdateMenuItem={store.updateMenuItem}
            onOpenRecipe={handleOpenRecipe}
            onCreateNewDish={handleCreateNewDish}
          />
        )}
      </Layout>

      <FirebaseGuideModal
        open={firebaseGuideOpen}
        onClose={() => setFirebaseGuideOpen(false)}
        isConfigured={store.isFirebaseConfigured}
        projectId={store.firebaseProjectId}
        databaseId={store.firebaseDatabaseId}
      />
    </>
  );
}
