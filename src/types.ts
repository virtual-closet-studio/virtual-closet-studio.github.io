export type Category = 'top' | 'outer' | 'bottom' | 'shoes';
export type Pattern = 'solid' | 'stripe' | 'check' | 'image';

export interface PhotoSide {
  image: string;
  // Retain the unmasked crop so erased pixels can be restored after saving.
  source: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}
export interface PhotoDesign { front: PhotoSide; back?: PhotoSide }

export interface Garment {
  id: string;
  name: string;
  category: Category;
  template: 'tee' | 'jacket' | 'pants' | 'skirt' | 'boots' | 'sneakers' | 'blazer' | 'shirt' | 'cargo';
  color: string;
  pattern: Pattern;
  image?: string;
  photoDesign?: PhotoDesign;
  createdAt: number;
}

export interface Outfit {
  id: string;
  name: string;
  garmentIds: Partial<Record<Category, string>>;
  body: Body;
  createdAt: number;
}

export interface Body { width: number; height: number }

export const CATEGORY_LABELS: Record<Category, string> = {
  top: 'インナー', outer: 'アウター', bottom: 'ボトムス', shoes: '靴',
};

export const TEMPLATES = {
  tee: { label: 'Tシャツ', category: 'top' },
  jacket: { label: 'パーカー', category: 'top' },
  pants: { label: 'スウェットパンツ', category: 'bottom' },
  cargo: { label: 'カーゴパンツ', category: 'bottom' },
  skirt: { label: 'スカート', category: 'bottom' },
  boots: { label: 'レザーブーツ', category: 'shoes' },
  sneakers: { label: 'スニーカー', category: 'shoes' },
  blazer: { label: 'ダブルジャケット', category: 'outer' },
  shirt: { label: 'シャツ', category: 'top' },
} as const;

export const STARTER_GARMENTS: Garment[] = [
  { id: 'sample-1', name: 'クラシック Tシャツ', category: 'top', template: 'tee', color: '#e9d9bd', pattern: 'solid', createdAt: 1 },
  { id: 'sample-2', name: 'ボーダー Tシャツ', category: 'top', template: 'tee', color: '#345b61', pattern: 'stripe', createdAt: 2 },
  { id: 'sample-3', name: 'ミント Tシャツ', category: 'top', template: 'tee', color: '#a6c9ba', pattern: 'solid', createdAt: 3 },
  { id: 'sample-4', name: 'ネイビー パーカー', category: 'top', template: 'jacket', color: '#36465b', pattern: 'solid', createdAt: 4 },
  { id: 'sample-5', name: 'チェック パーカー', category: 'top', template: 'jacket', color: '#9d715c', pattern: 'check', createdAt: 5 },
  { id: 'sample-6', name: 'チャコール スウェットパンツ', category: 'bottom', template: 'pants', color: '#414b50', pattern: 'solid', createdAt: 6 },
  { id: 'sample-7', name: 'アイボリー スウェットパンツ', category: 'bottom', template: 'pants', color: '#d8cfba', pattern: 'solid', createdAt: 7 },
];

export const ADDED_GARMENTS: Garment[] = [
  { id: 'material-boots', name: 'レザーブーツ', category: 'shoes', template: 'boots', color: '#65412b', pattern: 'solid', createdAt: 8 },
  { id: 'material-sneakers', name: 'スニーカー', category: 'shoes', template: 'sneakers', color: '#ece9e2', pattern: 'solid', createdAt: 9 },
  { id: 'material-blazer', name: 'ダブルジャケット', category: 'outer', template: 'blazer', color: '#3b414b', pattern: 'solid', createdAt: 10 },
  { id: 'material-shirt', name: 'シャツ', category: 'top', template: 'shirt', color: '#ffffff', pattern: 'solid', createdAt: 11 },
];

export const CARGO_GARMENT: Garment = { id: 'material-cargo', name: 'カーゴパンツ', category: 'bottom', template: 'cargo', color: '#69725a', pattern: 'solid', createdAt: 12 };
