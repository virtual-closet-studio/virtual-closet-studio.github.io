import { STARTER_GARMENTS, ADDED_GARMENTS, CARGO_GARMENT, type Body, type Garment, type Outfit } from './types';

const DB_NAME = 'closet-studio-v1';
const STORE = 'state';
export interface ClosetState {
  garments: Garment[];
  outfits: Outfit[];
  selected: Partial<Record<Garment['category'], string>>;
  body: Body;
  materialVersion?: number;
  categoryVersion?: number;
}

export const initialState = (): ClosetState => ({
  garments: structuredClone([...STARTER_GARMENTS, ...ADDED_GARMENTS, CARGO_GARMENT]), outfits: [], materialVersion: 2, categoryVersion: 1,
  selected: { top: 'sample-1', bottom: 'sample-6' },
  body: { width: 1, height: 1 },
});

export function migrateMaterials(state: ClosetState): ClosetState {
  if (!state.materialVersion) {
    for (const garment of ADDED_GARMENTS) {
      if (!state.garments.some((item) => item.id === garment.id)) state.garments.push(structuredClone(garment));
    }
    state.materialVersion = 1;
  }
  if (state.materialVersion < 2) {
    if (!state.garments.some(item => item.id === CARGO_GARMENT.id)) state.garments.push(structuredClone(CARGO_GARMENT));
    state.materialVersion = 2;
  }
  if (!state.categoryVersion) {
    state.garments.forEach(garment=>{if(garment.template==='jacket') garment.category='top';});
    const moveHoodie = (selection: ClosetState['selected']) => {
      const hoodie=state.garments.find(garment=>garment.id===selection.outer && garment.template==='jacket');
      if(hoodie) { selection.top=hoodie.id; delete selection.outer; }
    };
    moveHoodie(state.selected);
    state.outfits.forEach(outfit=>moveHoodie(outfit.garmentIds));
    state.categoryVersion=1;
  }
  return state;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadState(): Promise<ClosetState> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('closet');
      request.onsuccess = () => {
        const state: ClosetState = request.result ?? initialState();
        const renamed: Record<string, [string, string]> = {
          'sample-4': ['ネイビー ジャケット', 'ネイビー パーカー'],
          'sample-5': ['チェック ジャケット', 'チェック パーカー'],
          'sample-6': ['チャコール パンツ', 'チャコール スウェットパンツ'],
          'sample-7': ['アイボリー パンツ', 'アイボリー スウェットパンツ'],
        };
        state.garments.forEach((garment) => {
          const names = renamed[garment.id];
          if (names && garment.name === names[0]) garment.name = names[1];
        });
        resolve(migrateMaterials(state));
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveState(state: ClosetState): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, 'closet');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('保存できませんでした'));
    });
  } finally { db.close(); }
}

export async function storageStatus(): Promise<string> {
  if (!navigator.storage?.estimate) return '端末内に保存';
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return quota ? `端末内に保存 · ${(usage / 1048576).toFixed(1)} / ${(quota / 1048576).toFixed(0)} MB` : '端末内に保存';
}

export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください');
  if (file.size > 15 * 1048576) throw new Error('15 MB以下の画像を選択してください');
  const bitmap = await createImageBitmap(file);
  const max = 512;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.72);
}

export function exportState(state: ClosetState): void {
  const blob = new Blob([JSON.stringify({ version: 1, ...state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `closet-studio-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
