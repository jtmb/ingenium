"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, VaultItem, VaultFolder } from "../../lib/api";
import UnsealModal from "./components/UnsealModal";
import CreateVaultModal from "./components/CreateVaultModal";
import FolderTree from "./components/FolderTree";
import ItemList from "./components/ItemList";
import ItemDetail from "./components/ItemDetail";
import CreateItemModal from "./components/CreateItemModal";

/**
 * Secrets page — vault-based password manager.
 *
 * States:
 *   1. Loading — checking vault status
 *   2. First-run (sealed + not initialized) — CreateVaultModal for passphrase creation
 *   3. Sealed (initialized) — UnsealModal with passphrase input
 *   4. Unsealed — 3-pane layout: FolderTree | ItemList | ItemDetail
 */
export default function SecretsPage() {
  const project = useProject();

  const [loading, setLoading] = useState(true);
  const [sealed, setSealed] = useState(true);
  const [initialized, setInitialized] = useState(true); // default true for older API
  const [error, setError] = useState<string | null>(null);

  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);

  const [showUnseal, setShowUnseal] = useState(false);
  const [showCreateVault, setShowCreateVault] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.vault.status(project);
        if (cancelled) return;
        setSealed(r.data.sealed);
        setInitialized(r.data.initialized ?? true); // default true for older API
        if (r.data.sealed) {
          if (!(r.data.initialized ?? true)) {
            setShowCreateVault(true);
          } else {
            setShowUnseal(true);
          }
        }
      } catch {
        if (cancelled) return;
        setError("Unable to check vault status. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [project, refreshKey]);

  useEffect(() => {
    if (sealed) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [foldersRes, itemsRes] = await Promise.all([
          api.vault.folders.list(project),
          api.vault.items.list(undefined, project),
        ]);
        if (cancelled) return;
        setFolders(foldersRes.data);
        setItems(itemsRes.data);
      } catch {
        if (cancelled) return;
        setError("Unable to load vault data. Try again after unlocking the vault.");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sealed, project, refreshKey]);

  const filteredItems = selectedFolder
    ? items.filter((i) => i.folder_id === selectedFolder)
    : items;

  const handleUnsealSuccess = useCallback(() => {
    setShowUnseal(false);
    setSealed(false);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleCreateVaultSuccess = useCallback(() => {
    setShowCreateVault(false);
    setSealed(false);
    setInitialized(true);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleEmptyVaultReset = useCallback(() => {
    setShowUnseal(false);
    setSealed(true);
    setInitialized(false);
    setShowCreateVault(true);
  }, []);

  const handleSelectFolder = useCallback((folderId: string | null) => {
    setSelectedFolder(folderId);
    setSelectedItem(null);
  }, []);

  const handleSelectItem = useCallback((item: VaultItem) => {
    setSelectedItem(item);
  }, []);

  const handleItemUpdated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleItemDeleted = useCallback(() => {
    setSelectedItem(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleCreateItem = useCallback(() => {
    setShowCreate(true);
  }, []);

  const handleItemCreated = useCallback(() => {
    setShowCreate(false);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSeal = useCallback(async () => {
    try {
      await api.vault.seal(project);
      setSealed(true);
      setShowUnseal(true);
      setItems([]);
      setFolders([]);
      setSelectedFolder(null);
      setSelectedItem(null);
    } catch {
      setError("Unable to lock the vault. Try again.");
    }
  }, [project]);

  if (loading) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Secrets</h1>
        <p className="text-[var(--color-text-muted)]">Checking vault status...</p>
      </div>
    );
  }

  if (error && !sealed) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Secrets</h1>
        <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-4 rounded text-[var(--color-error-text)]">
          {error}
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sealed) {
    if (!initialized) {
      return (
        <div className="space-y-8">
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Secrets</h1>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-8 text-center">
            <div className="mb-4">
              <svg className="w-12 h-12 mx-auto text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" strokeWidth="1.5" />
                <path d="M7 11V7a5 5 0 0110 0v4" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="12" cy="16" r="1" fill="currentColor" />
                <path d="M12 14v4M10 16h4" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-[var(--color-text-secondary)] mb-4">
              No vault exists yet. Create a passphrase of at least 12 characters to secure it.
            </p>
            <button
              onClick={() => setShowCreateVault(true)}
              className="bg-blue-600 text-white py-2 px-6 rounded hover:bg-blue-700 transition-colors"
            >
              Create Your Vault
            </button>
          </div>
          <CreateVaultModal
            isOpen={showCreateVault}
            onClose={() => setShowCreateVault(false)}
            onSuccess={handleCreateVaultSuccess}
            project={project}
          />
        </div>
      );
    }

    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Secrets</h1>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-8 text-center">
          <div className="mb-4">
            <svg className="w-12 h-12 mx-auto text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2" strokeWidth="1.5" />
              <path d="M7 11V7a5 5 0 0110 0v4" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>
          <p className="text-[var(--color-text-secondary)] mb-4">
            The vault is sealed. Enter your passphrase to unlock.
          </p>
          <button
            onClick={() => setShowUnseal(true)}
            className="bg-blue-600 text-white py-2 px-6 rounded hover:bg-blue-700 transition-colors"
          >
            Unseal Vault
          </button>
        </div>
        <UnsealModal
          isOpen={showUnseal}
          onClose={() => setShowUnseal(false)}
          onSuccess={handleUnsealSuccess}
          onReset={handleEmptyVaultReset}
          project={project}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">Secrets</h1>
        <button
          onClick={handleSeal}
          className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] py-2 px-4 rounded text-sm hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors"
        >
          Lock Vault
        </button>
      </div>

      <div className="flex h-[calc(100dvh-160px)] border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden">
        <div className="w-56 shrink-0 border-r border-[var(--color-border)] overflow-y-auto bg-[var(--color-surface-muted)]">
          <FolderTree
            folders={folders}
            selectedFolder={selectedFolder}
            onSelectFolder={handleSelectFolder}
            onRefresh={() => setRefreshKey((k) => k + 1)}
            project={project}
          />
        </div>

        <div className="w-72 shrink-0 border-r border-[var(--color-border)] overflow-y-auto flex flex-col">
          <ItemList
            items={filteredItems}
            selectedItem={selectedItem}
            onSelectItem={handleSelectItem}
            onCreateItem={handleCreateItem}
          />
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto">
          <ItemDetail
            item={selectedItem}
            onItemUpdated={handleItemUpdated}
            onItemDeleted={handleItemDeleted}
            project={project}
          />
        </div>
      </div>

      <CreateItemModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleItemCreated}
        folders={folders}
        project={project}
      />
    </div>
  );
}
