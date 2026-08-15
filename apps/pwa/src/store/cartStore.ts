/**
 * FASE 5 — Shared, client-only cart store.
 *
 * Single source of truth for the PWA add-to-cart UX: consumed by BOTH the
 * storefront grid (EmptyState "Tambah") and the chat conversation cards
 * ("+ Keranjang"). A real order mutation lives on the backend (draft Order via
 * orderService.addConfirmedItemToOrder — skip-if-exists semantics, unsuitable
 * here), so this is a presentation/accumulator cart only (P-PWA cart authority).
 *
 * Reactive via useSyncExternalStore (React 19, no extra deps). Persisted to
 * localStorage so the header badge survives reloads.
 */
import { useSyncExternalStore } from 'react';

export interface CartItem {
  id: string; // product id (local key)
  productId: string; // FK to Product
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface CartProduct {
  id: string;
  name: string;
  price: number | null;
}

export interface CartSnapshot {
  items: CartItem[];
  total: number;
  count: number;
}

const STORAGE_KEY = 'garuda_pwa_cart';

let items: CartItem[] = [];
let snapshot: CartSnapshot = { items: [], total: 0, count: 0 };
const listeners = new Set<() => void>();

function priceToNumber(price: number | null | undefined): number {
  if (price == null || Number.isNaN(price)) return 0;
  return Math.max(0, Math.round(price));
}

function recalc(): void {
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const count = items.reduce((s, it) => s + it.quantity, 0);
  snapshot = { items: [...items], total, count };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (incognito/private) — cart stays in-memory */
  }
  listeners.forEach((cb) => cb());
}

function hydrate(): void {
  items = [];
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) items = JSON.parse(raw) as CartItem[];
    }
  } catch {
    items = [];
  }
  snapshot = {
    items: [...items],
    total: items.reduce((s, it) => s + it.subtotal, 0),
    count: items.reduce((s, it) => s + it.quantity, 0),
  };
}
hydrate();

export const cartStore = {
  addItem(product: CartProduct) {
    const price = priceToNumber(product.price);
    const existing = items.find((it) => it.productId === product.id);
    if (existing) {
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.unitPrice;
      recalc();
      return;
    }
    items = [
      ...items,
      {
        id: product.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: price,
        subtotal: price,
      },
    ];
    recalc();
  },
  removeItem(productId: string) {
    items = items.filter((it) => it.productId !== productId);
    recalc();
  },
  clear() {
    items = [];
    recalc();
  },
  /** @returns stable CartSnapshot reference (changes only on mutation). */
  peek(): CartSnapshot {
    return snapshot;
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export function useCart(): CartSnapshot {
  return useSyncExternalStore(cartStore.subscribe, cartStore.peek, cartStore.peek);
}
