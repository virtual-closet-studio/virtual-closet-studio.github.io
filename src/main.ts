import './style.css';
import { MAX_BACKUP_BYTES, parseBackup } from './backup';
import { ClosetScene } from './scene';
import { CATEGORY_LABELS, TEMPLATES, type Category, type Garment, type Pattern } from './types';
import { compressImage, exportState, initialState, loadState, saveState, storageStatus, type ClosetState } from './storage';

const app = document.querySelector<HTMLDivElement>('#app')!;
let state: ClosetState = initialState();
let activeCategory: Category | 'all' = 'all';
let editing: Garment | undefined;
let deleting: Garment | undefined;
let scene: ClosetScene;
let toastTimer = 0;
let fitRequest = 0;
let fitBody = '';
let fitPending = false;
let pendingImport: ClosetState | undefined;
const fitWorker = new Worker(new URL('./fit.worker.ts', import.meta.url), { type: 'module' });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function toast(message: string, error = false): void {
  const node = document.querySelector<HTMLElement>('#toast')!;
  node.textContent = message;
  node.className = `toast show ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 4500);
}

async function commit(next: ClosetState, success?: string): Promise<boolean> {
  try {
    await saveState(next);
    state = next;
    render();
    if (success) toast(success);
    return true;
  } catch (error) {
    const isQuota = error instanceof DOMException && error.name === 'QuotaExceededError';
    toast(isQuota ? '端末の保存容量が不足しています。画像を減らすか、データを書き出して整理してください。' : '保存に失敗しました。もう一度お試しください。', true);
    return false;
  }
}

function selectedGarments(): Garment[] {
  return (['bottom', 'top', 'outer', 'shoes'] as Category[]).map((category) => state.garments.find((g) => g.id === state.selected[category])).filter((g): g is Garment => !!g);
}

function updateScene(): void {
  const key = JSON.stringify(state.body);
  if (key !== fitBody) {
    fitBody = key; fitPending = true;
    fitWorker.postMessage({ id: ++fitRequest, width: state.body.width, height: state.body.height });
  } else if (!fitPending) scene.setLook(state.body, selectedGarments());
}

fitWorker.onmessage = (event: MessageEvent<{ id: number; width: number; height: number; outerWidth: number; depth: number; error?: string }>) => {
  if (event.data.id !== fitRequest) return;
  fitPending = false;
  if (event.data.error) { fitBody = ''; toast(event.data.error, true); return; }
  scene.setLook(state.body, selectedGarments(), event.data);
};

type WebTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => Promise<unknown> };
declare global {
  interface Document { modelContext?: { registerTool(tool: WebTool): void | Promise<void> } }
}

function registerWebTools(): void {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool: WebTool) => { try { void Promise.resolve(context.registerTool(tool)).catch(console.error); } catch (error) { console.error(error); } };
  register({
    name: 'list_wardrobe', title: 'クローゼットを見る', description: '登録された服、着用中の服、保存したコーデを取得します。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
    execute: async () => ({ garments: state.garments.map(({ id, name, category, template, color, pattern }) => ({ id, name, category, template, color, pattern })), selected: state.selected, outfits: state.outfits.map(({ id, name, garmentIds }) => ({ id, name, garmentIds })) }),
  });
  register({
    name: 'wear_garment', title: '服を着る', description: '指定した服を3Dアバターに着せ、端末内に保存します。',
    inputSchema: { type: 'object', properties: { garmentId: { type: 'string' } }, required: ['garmentId'], additionalProperties: false }, annotations: { readOnlyHint: false },
    execute: async (input) => {
      const garmentId = (input as { garmentId?: unknown })?.garmentId;
      if (typeof garmentId !== 'string') throw new Error('garmentIdが必要です');
      const garment = state.garments.find((g) => g.id === garmentId);
      if (!garment) throw new Error('服が見つかりません');
      const next = structuredClone(state);
      next.selected[garment.category] = garment.id;
      if (!await commit(next)) throw new Error('保存できませんでした');
      return { selected: state.selected };
    },
  });
  register({
    name: 'save_current_outfit', title: 'コーデを保存', description: '現在の着せ替えを名前付きコーデとして端末内に保存します。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: false },
    execute: async (input) => {
      const name = (input as { name?: unknown })?.name;
      if (typeof name !== 'string' || !name.trim() || name.length > 40) throw new Error('1〜40文字の名前が必要です');
      if (!selectedGarments().length) throw new Error('服を選んでください');
      const next = structuredClone(state);
      const outfit = { id: crypto.randomUUID(), name: name.trim(), garmentIds: structuredClone(state.selected), body: structuredClone(state.body), createdAt: Date.now() };
      next.outfits.push(outfit);
      if (!await commit(next)) throw new Error('保存できませんでした');
      return { id: outfit.id, name: outfit.name };
    },
  });
}

function garmentCard(g: Garment): string {
  const worn = state.selected[g.category] === g.id;
  return `<div class="garment-row ${worn ? 'worn' : ''}"><button class="garment-choice" data-action="wear" data-id="${escapeHtml(g.id)}" aria-pressed="${worn}"><span class="swatch" style="background-color:${escapeHtml(g.color)}" data-pattern="${g.pattern}"></span><span class="item-copy"><strong>${escapeHtml(g.name)}</strong><small>${TEMPLATES[g.template].label}</small></span>${worn ? '<span class="worn-badge">着用中</span>' : '<span class="row-arrow">＋</span>'}</button><button class="icon-button edit-item" data-action="edit" data-id="${escapeHtml(g.id)}" aria-label="${escapeHtml(g.name)}を編集">⋯</button></div>`;
}

function changeCategory(category: Category | 'all'): void {
  activeCategory = category;
  render(false);
  scene.setView(category === 'all' ? 'full' : category === 'shoes' ? 'feet' : category === 'bottom' ? 'lower' : 'upper');
  document.querySelector<HTMLButtonElement>(category === 'all' ? '[data-filter="top"]' : '#back')?.focus({ preventScroll: true });
}

function render(refreshScene = true): void {
  const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined;
  const focusId = focused?.dataset.id;
  const focusAction = focused?.dataset.action;
  const categories: Category[] = ['top', 'outer', 'bottom', 'shoes'];
  const list = state.garments.filter((g) => g.category === activeCategory);
  document.querySelector('#menu-title')!.textContent = activeCategory === 'all' ? '着せ替える' : CATEGORY_LABELS[activeCategory];
  document.querySelector('#menu-subtitle')!.textContent = activeCategory === 'all' ? 'カテゴリを選んで、あなたらしい一着を。' : '服を選んで、アバターに試着。';
  document.querySelector<HTMLElement>('#back')!.hidden = activeCategory === 'all';
  document.querySelector('#view-label')!.textContent = activeCategory === 'all' ? '全身' : activeCategory === 'shoes' ? '靴 / 足元' : activeCategory === 'bottom' ? 'ボトムス / 下半身' : `${CATEGORY_LABELS[activeCategory]} / 上半身`;
  document.querySelector('#garment-grid')!.innerHTML = activeCategory === 'all'
    ? categories.map((category, index) => {
      const worn = state.garments.find((g) => g.id === state.selected[category]);
      return `<button class="category-row" data-filter="${category}"><span class="category-number">0${index + 1}</span><span class="item-copy"><strong>${CATEGORY_LABELS[category]}</strong><small>${worn ? escapeHtml(worn.name) : '未着用'}</small></span><span class="row-arrow">→</span></button>`;
    }).join('')
    : `<div class="category-switch" aria-label="カテゴリ切り替え">${categories.map((category) => `<button data-filter="${category}" aria-pressed="${category === activeCategory}" class="${category === activeCategory ? 'active' : ''}">${CATEGORY_LABELS[category]}</button>`).join('')}</div>${list.map(garmentCard).join('') || '<p class="empty">まだ服がありません。「服を追加」から登録できます。</p>'}<button class="remove-choice" data-action="remove" data-category="${activeCategory}">このカテゴリの服を脱ぐ <span>−</span></button>`;
  document.querySelector('#count')!.textContent = `${state.garments.length} 点のアイテム`;
  document.querySelector('#current-look')!.innerHTML = (['top', 'outer', 'bottom', 'shoes'] as Category[]).map((category) => {
    const g = state.garments.find((item) => item.id === state.selected[category]);
    return `<div class="look-row"><span>${CATEGORY_LABELS[category]}</span><strong>${g ? escapeHtml(g.name) : '未選択'}</strong>${g ? `<button data-action="remove" data-category="${category}" aria-label="${CATEGORY_LABELS[category]}を脱ぐ">×</button>` : ''}</div>`;
  }).join('');
  document.querySelector('#outfit-list')!.innerHTML = state.outfits.length ? state.outfits.slice().reverse().map((outfit) => `<div class="outfit-row"><button data-action="load-outfit" data-id="${outfit.id}"><span class="outfit-dot">◉</span><span><strong>${escapeHtml(outfit.name)}</strong><small>${Object.values(outfit.garmentIds).filter(Boolean).length} 点のコーデ</small></span></button><button class="icon-button" data-action="delete-outfit" data-id="${outfit.id}" aria-label="コーデを削除">×</button></div>`).join('') : '<p class="empty small">保存したコーデはここに表示されます。</p>';
  document.querySelector<HTMLInputElement>('#body-width')!.value = String(state.body.width * 100);
  document.querySelector<HTMLInputElement>('#body-height')!.value = String(state.body.height * 100);
  document.querySelector('#width-value')!.textContent = `${Math.round(state.body.width * 100)}%`;
  document.querySelector('#height-value')!.textContent = `${Math.round(state.body.height * 100)}%`;
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeCategory));
  storageStatus().then((text) => { const node = document.querySelector('#storage-status'); if (node) node.textContent = text; });
  if (refreshScene) updateScene();
  if (focused && !focused.isConnected && focusId && focusAction) {
    document.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  }
}

function openEditor(item?: Garment): void {
  if (item?.photoDesign) { void launchPhotoEditor(item); return; }
  editing = item;
  const dialog = document.querySelector<HTMLDialogElement>('#editor')!;
  const form = document.querySelector<HTMLFormElement>('#garment-form')!;
  form.reset();
  document.querySelector('#editor-title')!.textContent = item ? '服を編集' : '服を追加';
  document.querySelector<HTMLInputElement>('#garment-name')!.value = item?.name ?? '';
  document.querySelector<HTMLSelectElement>('#garment-template')!.value = item?.template ?? (activeCategory === 'shoes' ? 'boots' : activeCategory === 'bottom' ? 'pants' : activeCategory === 'outer' ? 'blazer' : 'tee');
  document.querySelector<HTMLInputElement>('#garment-color')!.value = item?.color ?? '#d9ac83';
  document.querySelector<HTMLSelectElement>('#garment-pattern')!.value = item?.pattern ?? 'solid';
  document.querySelector<HTMLElement>('#delete-garment')!.hidden = !item;
  document.querySelector<HTMLElement>('#image-field')!.hidden = (item?.pattern ?? 'solid') !== 'image';
  document.querySelector('#image-note')!.textContent = item?.image ? '現在の画像を使用中。変更する場合は選び直してください。' : '画像は縮小して端末内に保存します。';
  dialog.showModal();
  document.querySelector<HTMLInputElement>('#garment-name')!.focus();
}

async function launchPhotoEditor(item?: Garment): Promise<void> {
  try {
    const { openPhotoEditor } = await import('./photo-editor');
    await openPhotoEditor({ item, body: { ...state.body },
      save: async garment => {
        const next = structuredClone(state);
        next.garments = item ? next.garments.map(g => g.id === garment.id ? garment : g) : [...next.garments, garment];
        if (item && item.category !== garment.category && next.selected[item.category] === item.id) delete next.selected[item.category];
        return commit(next, item ? '写真の服を更新しました' : '写真の服を追加しました');
      },
      remove: item ? async () => {
        const next = structuredClone(state); next.garments = next.garments.filter(g => g.id !== item.id);
        if (next.selected[item.category] === item.id) delete next.selected[item.category];
        return commit(next, '服を削除しました');
      } : undefined,
    });
  } catch { toast('写真編集を開けませんでした。もう一度お試しください。', true); }
}

async function saveGarment(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const name = document.querySelector<HTMLInputElement>('#garment-name')!.value.trim();
  const template = document.querySelector<HTMLSelectElement>('#garment-template')!.value as Garment['template'];
  const color = document.querySelector<HTMLInputElement>('#garment-color')!.value;
  const pattern = document.querySelector<HTMLSelectElement>('#garment-pattern')!.value as Pattern;
  const file = document.querySelector<HTMLInputElement>('#garment-image')!.files?.[0];
  if (!name) { toast('服の名前を入力してください', true); return; }
  let image = pattern === 'image' ? editing?.image : undefined;
  try { if (file) image = await compressImage(file); } catch (error) { toast(String(error), true); return; }
  if (pattern === 'image' && !image) { toast('テクスチャ画像を選択してください', true); return; }
  const garment: Garment = { id: editing?.id ?? crypto.randomUUID(), name, template, category: TEMPLATES[template].category, color, pattern, image, createdAt: editing?.createdAt ?? Date.now() };
  const next = structuredClone(state);
  next.garments = editing ? next.garments.map((g) => g.id === editing!.id ? garment : g) : [...next.garments, garment];
  if (editing && editing.category !== garment.category && next.selected[editing.category] === editing.id) delete next.selected[editing.category];
  const saved = await commit(next, editing ? '服を更新しました' : '服を追加しました');
  if (saved) document.querySelector<HTMLDialogElement>('#editor')!.close();
}

async function handleAction(action: string, source: HTMLElement): Promise<void> {
  const id = source.dataset.id;
  if (action === 'wear' && id) {
    const garment = state.garments.find((g) => g.id === id)!;
    const next = structuredClone(state);
    next.selected[garment.category] = id;
    await commit(next);
  } else if (action === 'remove') {
    const next = structuredClone(state);
    delete next.selected[source.dataset.category as Category];
    await commit(next);
  } else if (action === 'edit' && id) openEditor(state.garments.find((g) => g.id === id));
  else if (action === 'load-outfit' && id) {
    const outfit = state.outfits.find((o) => o.id === id)!;
    const next = structuredClone(state);
    next.selected = Object.fromEntries(Object.entries(outfit.garmentIds).filter(([, garmentId]) => next.garments.some((g) => g.id === garmentId)));
    next.body = outfit.body;
    await commit(next, `「${outfit.name}」を表示しました`);
  } else if (action === 'delete-outfit' && id) {
    const next = structuredClone(state);
    next.outfits = next.outfits.filter((o) => o.id !== id);
    await commit(next, 'コーデを削除しました');
  }
}

async function init(): Promise<void> {
  app.innerHTML = `<div class="shell">
    <header class="topbar"><a class="brand" href="./" aria-label="バーチャルクローゼット ホーム"><span class="brand-name">バーチャルクローゼット<small>VIRTUAL CLOSET</small></span></a><div class="topbar-right"><span class="local-indicator"><i></i> この端末に保存</span><button id="import" class="text-button">データを読み込む ↙</button><input id="import-file" type="file" accept=".json,application/json" hidden /><button id="export" class="text-button">データを書き出す ↗</button></div></header>
    <div class="page-heading"><div><span class="section-kicker">YOUR EVERYDAY, REIMAGINED</span><h1>今日の服を、自由に。</h1></div><p>組み合わせて、眺めて、見つける。<br>あなたのためのバーチャル試着室。</p></div>
    <main class="workspace">
      <section class="closet-panel" aria-label="クローゼット"><div class="menu-heading"><span class="section-kicker">MY WARDROBE</span><span id="count"></span></div><button id="back" class="back-button" hidden>← 戻る <span>全身表示</span></button><h2 id="menu-title">着せ替える</h2><p id="menu-subtitle" class="menu-subtitle"></p><button id="add-photo" class="add-button photo-add">写真から追加 ↗</button><div id="garment-grid" class="garment-grid"></div><button id="add-garment" class="add-button">＋ 手動で服を追加</button><div class="menu-note"><span>MAKE IT YOURS</span><p>いつもの服も、新しい組み合わせに。<br>気になる一着から試してみよう。</p></div></section>
      <section class="stage-panel" aria-label="3D試着プレビュー"><div class="stage-top"><span class="studio-label"><i></i> FITTING ROOM</span><span id="view-label" aria-live="polite">全身</span></div><div id="scene" class="scene"></div><div class="stage-controls"><button id="reset-camera" class="view-button" aria-label="視点を戻す">⟳ <span>視点を戻す</span></button></div><div class="stage-footer"><span>ドラッグで回転 · スクロールで拡大</span><span class="stage-tag">VIRTUAL FITTING / 01</span></div></section>
    </main>
    <div class="workspace-toolbar"><span class="toolbar-caption">YOUR LOOK, YOUR WAY.</span><div class="toolbar-actions"><button data-panel="look">着用アイテム</button><button data-panel="body">体形調整</button><button data-panel="outfits">保存したコーデ</button><button id="save-outfit" class="primary-button">コーデを保存 ＋</button></div></div><footer class="site-footer"><span>バーチャルクローゼット</span><span>毎日の「何を着よう」を、もっと楽しく。</span></footer>
  </div>
  <dialog id="details" class="editor details-dialog" aria-labelledby="details-title"><div class="dialog-heading"><div><span class="section-kicker">MY CLOSET</span><h2 id="details-title"></h2></div><button type="button" data-close="details" class="icon-button" aria-label="閉じる">×</button></div><section data-section="look"><div id="current-look"></div><p class="hint">左のカテゴリメニューから服を選べます。</p></section><section data-section="body"><label class="slider-label" for="body-width">体の幅 <span id="width-value">100%</span></label><input id="body-width" type="range" min="75" max="135" value="100" /><label class="slider-label" for="body-height">身長 <span id="height-value">100%</span></label><input id="body-height" type="range" min="80" max="125" value="100" /><p class="hint">簡易的な体形調整です。実寸のフィット感は再現しません。</p></section><section data-section="outfits"><div id="outfit-list"></div></section><p class="storage" id="storage-status">端末内に保存</p></dialog>
  <dialog id="import-dialog" class="editor" aria-labelledby="import-title"><div class="dialog-heading"><h2 id="import-title">データを読み込む</h2><button type="button" data-close="import-dialog" class="icon-button" aria-label="閉じる">×</button></div><p id="import-summary"></p><p class="hint">この端末の服・コーデ・体形・着用状態を、バックアップの内容に置き換えます。必要なデータは先に書き出してください。</p><button id="backup-before-import" class="text-button">現在のデータを書き出す ↗</button><p id="import-error" role="alert"></p><div class="dialog-actions"><button type="button" data-close="import-dialog" class="text-button">キャンセル</button><button type="button" id="confirm-import" class="primary-button">置き換えて読み込む</button></div></dialog>
  <dialog id="outfit-editor" class="editor" aria-labelledby="outfit-title"><form id="outfit-form"><div class="dialog-heading"><div><span class="section-kicker">SAVE YOUR LOOK</span><h2 id="outfit-title">コーデを保存</h2></div><button type="button" data-close="outfit-editor" class="icon-button" aria-label="閉じる">×</button></div><label>コーデの名前<input id="outfit-name" maxlength="40" required placeholder="例：休日のリラックスコーデ" /></label><div class="dialog-actions"><button type="submit" class="primary-button">保存する</button></div></form></dialog>
  <dialog id="delete-dialog" class="editor" aria-labelledby="delete-title"><div class="dialog-heading"><h2 id="delete-title">服を削除</h2><button type="button" data-close="delete-dialog" class="icon-button" aria-label="閉じる">×</button></div><p id="delete-message" class="hint"></p><div class="dialog-actions"><button type="button" data-close="delete-dialog" class="text-button">キャンセル</button><button type="button" id="confirm-delete" class="primary-button">削除する</button></div></dialog><dialog id="editor" class="editor" aria-labelledby="editor-title"><form id="garment-form"><div class="dialog-heading"><div><span class="section-kicker">WARDROBE ITEM</span><h2 id="editor-title">服を追加</h2></div><button type="button" id="close-editor" class="icon-button" aria-label="閉じる">×</button></div><label>服の名前<input id="garment-name" maxlength="40" required placeholder="例：お気に入りのTシャツ" /></label><div class="form-row"><label>服の形<select id="garment-template"><option value="tee">Tシャツ</option><option value="jacket">パーカー</option><option value="pants">スウェットパンツ</option><option value="cargo">カーゴパンツ</option><option value="skirt">スカート</option><option value="boots">レザーブーツ</option><option value="sneakers">スニーカー</option><option value="blazer">ダブルジャケット</option><option value="shirt">シャツ</option></select></label><label>色<input id="garment-color" type="color" value="#d9ac83" /></label></div><label>柄・テクスチャ<select id="garment-pattern"><option value="solid">無地</option><option value="stripe">ボーダー</option><option value="check">チェック</option><option value="image">画像を使用</option></select></label><label id="image-field" hidden>テクスチャ画像<input id="garment-image" type="file" accept="image/*" /><small id="image-note"></small></label><div class="dialog-actions"><button id="delete-garment" type="button" class="danger-button" hidden>この服を削除</button><button type="submit" class="primary-button">保存する</button></div></form></dialog><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
  scene = new ClosetScene(document.querySelector<HTMLElement>('#scene')!);
  void scene.ready.catch(() => toast('3Dモデルを読み込めませんでした。通信環境を確認して再読み込みしてください。', true));
  try { state = await loadState();
  await saveState(state); } catch { toast('端末内のデータを読み込めませんでした。保存機能をご確認ください。', true); }
  render();
  document.querySelector('#add-photo')!.addEventListener('click', () => { void launchPhotoEditor(); });
  document.querySelector('#add-garment')!.addEventListener('click', () => openEditor());
  document.querySelector('#export')!.addEventListener('click', () => exportState(state));
  const importFile = document.querySelector<HTMLInputElement>('#import-file')!;
  const importDialog = document.querySelector<HTMLDialogElement>('#import-dialog')!;
  const importButton = document.querySelector<HTMLButtonElement>('#confirm-import')!;
  let importBusy = false;
  document.querySelector('#import')!.addEventListener('click', () => importFile.click());
  document.querySelector('#backup-before-import')!.addEventListener('click', () => exportState(state));
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    pendingImport = undefined;
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップは50 MB以下のファイルを選んでください。');
      pendingImport = parseBackup(await file.text());
      document.querySelector('#import-summary')!.textContent = '服 ' + pendingImport.garments.length + ' 点、コーデ ' + pendingImport.outfits.length + ' 件を読み込みます。';
      document.querySelector('#import-error')!.textContent = '';
      importDialog.showModal();
    } catch (error) { toast(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。', true); }
  });
  importDialog.addEventListener('cancel', event => { if (importBusy) event.preventDefault(); });
  importDialog.addEventListener('close', () => { pendingImport = undefined; });
  importButton.addEventListener('click', async () => {
    if (!pendingImport || importBusy) return;
    importBusy = true;
    const buttons = importDialog.querySelectorAll<HTMLButtonElement>('button');
    buttons.forEach(button => { button.disabled = true; });
    const restored = await commit(pendingImport, 'バックアップを読み込みました');
    importBusy = false;
    buttons.forEach(button => { button.disabled = false; });
    if (restored) importDialog.close();
    else document.querySelector('#import-error')!.textContent = '保存できませんでした。元のデータは保持されています。端末の空き容量を確認して再試行してください。';
  });
  document.querySelector('#reset-camera')!.addEventListener('click', () => scene.resetCamera());
  document.querySelector('#close-editor')!.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#editor')!.close());
  document.querySelector<HTMLFormElement>('#garment-form')!.addEventListener('submit', saveGarment);
  document.querySelector<HTMLSelectElement>('#garment-pattern')!.addEventListener('change', (event) => { document.querySelector<HTMLElement>('#image-field')!.hidden = (event.target as HTMLSelectElement).value !== 'image'; });
  document.querySelector('#delete-garment')!.addEventListener('click', () => {
    if (!editing) return;
    deleting = editing;
    document.querySelector('#delete-message')!.textContent = `「${deleting.name}」を削除しますか？ この操作は元に戻せません。`;
    document.querySelector<HTMLDialogElement>('#delete-dialog')!.showModal();
  });
  document.querySelector('#confirm-delete')!.addEventListener('click', async () => {
    if (!deleting) return;
    const next = structuredClone(state);
    next.garments = next.garments.filter((g) => g.id !== deleting!.id);
    if (next.selected[deleting.category] === deleting.id) delete next.selected[deleting.category];
    if (await commit(next, '服を削除しました')) {
      document.querySelector<HTMLDialogElement>('#delete-dialog')!.close();
      document.querySelector<HTMLDialogElement>('#editor')!.close();
      deleting = undefined;
    }
  });
  document.querySelector('#save-outfit')!.addEventListener('click', () => {
    if (!selectedGarments().length) { toast('先に服を選んでください', true); return; }
    document.querySelector<HTMLInputElement>('#outfit-name')!.value = `コーデ ${state.outfits.length + 1}`;
    document.querySelector<HTMLDialogElement>('#outfit-editor')!.showModal();
    document.querySelector<HTMLInputElement>('#outfit-name')!.select();
  });
  document.querySelector<HTMLFormElement>('#outfit-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.querySelector<HTMLInputElement>('#outfit-name')!.value.trim();
    if (!name) { toast('コーデの名前を入力してください', true); return; }
    const next = structuredClone(state);
    next.outfits.push({ id: crypto.randomUUID(), name: name.slice(0, 40), garmentIds: structuredClone(state.selected), body: structuredClone(state.body), createdAt: Date.now() });
    if (await commit(next, 'コーデを保存しました')) document.querySelector<HTMLDialogElement>('#outfit-editor')!.close();
  });
  document.querySelector('#back')!.addEventListener('click', () => changeCategory('all'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && activeCategory !== 'all') {
      event.preventDefault();
      changeCategory('all');
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => button.addEventListener('click', () => {
    const panel = button.dataset.panel!;
    document.querySelector('#details-title')!.textContent = button.textContent;
    document.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => { section.hidden = section.dataset.section !== panel; });
    document.querySelector<HTMLDialogElement>('#details')!.showModal();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.close!);
    if (dialog instanceof HTMLDialogElement) dialog.close();
  }));
  document.querySelectorAll<HTMLInputElement>('#body-width, #body-height').forEach((input) => input.addEventListener('change', async () => {
    const next = structuredClone(state);
    next.body = { width: Number(document.querySelector<HTMLInputElement>('#body-width')!.value) / 100, height: Number(document.querySelector<HTMLInputElement>('#body-height')!.value) / 100 };
    await commit(next);
  }));
  document.querySelectorAll<HTMLInputElement>('#body-width, #body-height').forEach((input) => input.addEventListener('input', () => {
    document.querySelector('#width-value')!.textContent = `${document.querySelector<HTMLInputElement>('#body-width')!.value}%`;
    document.querySelector('#height-value')!.textContent = `${document.querySelector<HTMLInputElement>('#body-height')!.value}%`;
  }));
  app.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const filter = target.closest<HTMLElement>('[data-filter]');
    if (filter) { changeCategory(filter.dataset.filter as Category | 'all'); return; }
    const action = target.closest<HTMLElement>('[data-action]');
    if (action) await handleAction(action.dataset.action!, action);
  });
  registerWebTools();
}

void init();

