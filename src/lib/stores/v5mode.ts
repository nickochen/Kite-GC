// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Marc Hoffmann (b14ckyy)

// v5 UI mode flag — whether the v5 flight-monitor layout is active.
// Persisted to localStorage ('kite-gc-v5mode'), defaults to true.
// SSR-safe: localStorage is only touched in the browser.

import { writable } from 'svelte/store';

const STORAGE_KEY = 'kite-gc-v5mode';

function readInitial(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export const v5mode = writable<boolean>(readInitial());

// Keep the persisted value in sync with the store (browser only).
v5mode.subscribe((value) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable (private mode, quota, …) — the in-memory value still works.
  }
});
