"use client";

import type { PersistedCanvasElement } from "@/components/canvas/types";

const DB_NAME = "media-canvas";
const DB_VERSION = 1;
const STORE_NAME = "blobs";
const META_KEY = "media-canvas-elements-v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser() || !("indexedDB" in window)) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open DB"));
  });
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ key, blob, type: blob.type, updatedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("putBlob failed"));
  });
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDb();
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const res = req.result as { key: string; blob: Blob } | undefined;
        resolve(res?.blob);
      };
      req.onerror = () => reject(req.error ?? new Error("getBlob failed"));
    });
  } catch {
    return undefined;
  }
}

export async function deleteBlob(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("deleteBlob failed"));
    });
  } catch {
    // ignore deletion errors
  }
}

export function saveElementsMetadata(elements: PersistedCanvasElement[]): void {
  if (!isBrowser()) return;
  try {
    const json = JSON.stringify(elements);
    localStorage.setItem(META_KEY, json);
  } catch {
    // ignore
  }
}

export function loadElementsMetadata(): PersistedCanvasElement[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCanvasElement[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
