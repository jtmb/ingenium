---
title: Secrets User Guide
description: Complete guide to the Ingenium Secrets vault — first-run setup, passphrase creation, unsealing, and item management.
---

# Ingenium Secrets Vault User Guide

The Secrets page (`/secrets`) is a vault-based password manager with scrypt key derivation and AES-256-GCM encryption. It stores sensitive credentials (API keys, passwords, tokens) organized in folders, secured by a user-chosen passphrase that is **never stored on the server**.

## Vault States

The vault has four top-level states:

```
┌──────────────┐
│   Loading    │  → Checking vault status from API
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│  Sealed + No Vault   │  → First-run: Create a new vault
│  (not initialized)   │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│  Sealed + Vault      │  → Routine: Unseal existing vault
│  Exists (initialized)│
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│     Unsealed         │  → Full access: browse, create, edit, delete
└──────────────────────┘
```

## First-Run: Create Your Vault

When visiting `/secrets` for the first time (no vault initialized), the page shows a "Create Your Vault" card. Clicking it opens the **CreateVaultModal**.

### The CreateVaultModal

This dialog collects a new vault passphrase. It includes:

| Element | Description |
|---------|-------------|
| Lock icon | Centered above the title |
| Title | "Create Your Vault Passphrase" |
| Warning | Amber banner: "**No recovery key exists.** There is no way to reset or recover a lost passphrase." |
| Passphrase field | Password input with show/hide toggle. Minimum 12 characters. |
| Passphrase hint | Shows `(n/12)` in red when too short; turns green when valid |
| Confirmation field | Re-enter the passphrase |
| Match/mismatch hint | Red "Passphrases do not match" or green checkmark "Passphrases match" |
| Acknowledgement checkbox | "I understand there is no passphrase recovery" |
| Actions | Cancel (ghost) + "Create & Unseal Vault" (blue primary) |

### Validation States

| State | What You See |
|-------|-------------|
| **Empty** | Placeholder text "At least 12 characters" in hint |
| **Too short** | Red counter: "At least 12 characters (5/12)" |
| **Mismatch** | Red text: "Passphrases do not match" |
| **Match + valid** | Green checkmark: "Passphrases match" |
| **Checkbox unchecked** | Submit button disabled |
| **All valid + checked** | Submit button enabled ("Create & Unseal Vault") |

The submit button is gated on all three conditions:
1. Passphrase ≥ 12 characters AND matches confirmation
2. Acknowledgement checkbox checked
3. Not currently saving

## Routine: Unseal the Vault

On subsequent visits, the vault is sealed but initialized. The page shows an "Unseal Vault" card. Clicking it opens the **UnsealModal** — a simpler dialog with:

| Element | Description |
|---------|-------------|
| Lock icon | Centered, muted color |
| Title | "Unseal Vault" |
| Description | "Enter your vault passphrase to unlock all secrets." |
| Passphrase input | Single password field with placeholder "Vault passphrase" |
| Actions | Cancel + "Unseal Vault" (disabled when empty) |

The submit button is enabled only when the passphrase field is non-empty. Pressing Enter also submits.

### Error Handling

If the passphrase is incorrect, a red error banner appears inside the modal:
- "Failed to unseal vault. Check your passphrase."
- On API errors: shows the error message from the server.

## Unsealed State: 3-Pane Layout

Once unsealed, the page reveals a three-pane layout:

```
┌─────────────────┬─────────────────┬──────────────────────────────┐
│   FolderTree    │    ItemList     │        ItemDetail            │
│   (w-56)        │    (w-72)       │        (flex-1)              │
│                 │                 │                              │
│  ┌─────────┐    │  ┌─────────┐    │  Item name, credentials,    │
│  │ All items│    │  │ Item 1  │    │  notes, folder, timestamps  │
│  │ Folder A │    │  │ Item 2  │    │                              │
│  │ Folder B │    │  │ Item 3  │    │  Edit / Delete actions      │
│  └─────────┘    │  └─────────┘    │                              │
└─────────────────┴─────────────────┴──────────────────────────────┘
```

### Lock Vault Button

The page header has a "Lock Vault" button that re-seals the vault and clears all displayed data from memory (client-side). The UnsealModal re-appears.

### Folder Tree (Left)

- Shows all folders in a collapsible tree
- Click "All items" to clear the folder filter
- Click a folder name to filter items
- Folders can be created and deleted

### Item List (Center)

- Lists vault items filtered by the selected folder
- Each item shows its name and folder
- "New item" button at the top
- Click an item to view its details

### Item Detail (Right)

- Displays selected item's full details:
  - Name
  - Credential type and value
  - Folder association
  - Notes
  - Created/updated timestamps
- Edit and delete actions available

### Creating Items

The "New item" button opens a CreateItemModal with fields for name, credential value, folder, and notes.

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/vault/status` | GET | Check if vault is sealed and initialized |
| `/api/v1/vault/initialize` | POST | Create a new vault (passphrase + confirmation) |
| `/api/v1/vault/unseal` | POST | Unseal vault with passphrase |
| `/api/v1/vault/seal` | POST | Re-seal the vault |
| `/api/v1/vault/folders` | GET | List all folders |
| `/api/v1/vault/folders` | POST | Create a new folder |
| `/api/v1/vault/folders/:id` | DELETE | Delete a folder |
| `/api/v1/vault/items` | GET | List all items (optional `folder_id` filter) |
| `/api/v1/vault/items` | POST | Create a new item |
| `/api/v1/vault/items/:id` | PATCH | Update an item |
| `/api/v1/vault/items/:id` | DELETE | Delete an item |

## Security Notes

- The passphrase is **never stored** on the server. It is used client-side for scrypt key derivation to produce the AES-256-GCM encryption key.
- There is **no passphrase recovery**. If the passphrase is lost, all secrets are permanently inaccessible.
- On "Lock Vault", the client clears all decrypted data from memory.
- On page load, the vault status is checked and the appropriate modal is shown automatically.
