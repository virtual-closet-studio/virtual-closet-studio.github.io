import { migrateMaterials, type ClosetState } from './storage';
import { TEMPLATES, type Body, type Category, type Garment, type Outfit } from './types';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const categories: Category[] = ['top', 'outer', 'bottom', 'shoes'];
const invalid = (): never => { throw new Error('バックアップの内容が正しくありません。元のサイトから書き出したJSONを選んでください。'); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const string = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid();
  return value;
};
const number = (value: unknown, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid();
  return value;
};
const body = (value: unknown): Body => {
  const b = record(value);
  return { width: number(b.width, .75, 1.35), height: number(b.height, .8, 1.25) };
};
const selection = (value: unknown): ClosetState['selected'] => {
  const source = record(value);
  if (Object.keys(source).some(key => !categories.includes(key as Category))) return invalid();
  const result: ClosetState['selected'] = {};
  for (const category of categories) {
    if (source[category] !== undefined) result[category] = string(source[category], 200);
  }
  return result;
};

/** Parse into fresh, allowlisted objects; never mutate the currently saved state. */
export function parseBackup(text: string): ClosetState {
  if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error('バックアップは50 MB以下のファイルを選んでください。');
  let source: Record<string, unknown>;
  try { source = record(JSON.parse(text)); } catch { return invalid(); }
  if (source.version !== 1) throw new Error('対応していないバックアップ形式です。バージョン1のJSONを選んでください。');
  if (!Array.isArray(source.garments) || !Array.isArray(source.outfits)) return invalid();
  const garments: Garment[] = source.garments.map(value => {
    const g = record(value);
    const template = string(g.template, 30) as Garment['template'];
    if (!Object.hasOwn(TEMPLATES, template) || !categories.includes(g.category as Category)) return invalid();
    if (!['solid', 'stripe', 'check', 'image'].includes(g.pattern as string)) return invalid();
    if (typeof g.color !== 'string' || !/^#[\da-f]{6}$/i.test(g.color)) return invalid();
    if (g.image !== undefined && (typeof g.image !== 'string' || !/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(g.image))) return invalid();
    if (g.pattern === 'image' && !g.image) return invalid();
    return {
      id: string(g.id, 200), name: string(g.name, 40), template,
      category: g.category as Category, pattern: g.pattern as Garment['pattern'], color: g.color,
      ...(g.image === undefined ? {} : { image: g.image as string }),
      createdAt: number(g.createdAt, 0, Number.MAX_SAFE_INTEGER),
    };
  });
  const outfits: Outfit[] = source.outfits.map(value => {
    const o = record(value);
    return { id: string(o.id, 200), name: string(o.name, 40), garmentIds: selection(o.garmentIds), body: body(o.body), createdAt: number(o.createdAt, 0, Number.MAX_SAFE_INTEGER) };
  });
  for (const items of [garments, outfits]) {
    if (new Set(items.map(item => item.id)).size !== items.length) return invalid();
  }
  const version = (value: unknown, max: number): number | undefined => {
    if (value === undefined) return undefined;
    const result = number(value, 0, max);
    if (!Number.isInteger(result)) return invalid();
    return result;
  };
  const result = migrateMaterials({
    garments, outfits, selected: selection(source.selected), body: body(source.body),
    materialVersion: version(source.materialVersion, 2), categoryVersion: version(source.categoryVersion, 1),
  });
  const byId = new Map(result.garments.map(g => [g.id, g]));
  for (const g of result.garments) if (g.category !== TEMPLATES[g.template].category) return invalid();
  for (const selected of [result.selected, ...result.outfits.map(o => o.garmentIds)]) {
    for (const category of categories) {
      const id = selected[category];
      if (id !== undefined && byId.get(id)?.category !== category) return invalid();
    }
  }
  return result;
}
