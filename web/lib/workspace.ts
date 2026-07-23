"use client";

import { useSyncExternalStore } from "react";

// Active workspace = active Qdrant collection, shared across pages via localStorage.
const KEY = "ccragos_workspace";
const DEFAULT = "ccragos_chunks";
const listeners = new Set<() => void>();

function read(): string {
  if (typeof localStorage === "undefined") return DEFAULT;
  return localStorage.getItem(KEY) || DEFAULT;
}

export function setWorkspace(collection: string) {
  localStorage.setItem(KEY, collection);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useWorkspace() {
  const collection = useSyncExternalStore(subscribe, read, () => DEFAULT);
  return { collection, setWorkspace };
}
