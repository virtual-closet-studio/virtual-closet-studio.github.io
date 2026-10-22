import { ClosetScene } from './scene';
import { TEMPLATES, type Body, type Garment, type PhotoSide } from './types';
import { dominantColor, foregroundBounds, readPhoto, removeBackground } from './photo-processing';
import './photo-editor.css';

type SideName = 'front' | 'back';
type Editable = { source: HTMLCanvasElement; mask: HTMLCanvasElement; placement: PhotoSide; undo: ImageData[] };
type Options = { item?: Garment; body: Body; save: (garment: Garment) => Promise<boolean>; remove?: () => Promise<boolean> };
const optionsHTML = Object.entries(TEMPLATES).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('');
const defaultPlacement = (): PhotoSide => ({ image: '', source: '', x: 0, y: 0, scale: 1, rotation: 0 });

function canvasCopy(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  canvas.getContext('2d')!.drawImage(source, 0, 0); return canvas;
}
async function decode(url: string) {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.drawImage(image, 0, 0); return canvas;
}

export async function openPhotoEditor(options: Options): Promise<void> {
  if (document.querySelector('#photo-editor')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'photo-editor'; dialog.className = 'editor photo-editor';
  dialog.setAttribute('aria-labelledby', 'photo-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="section-kicker">PHOTO TO WARDROBE</span><h2 id="photo-title">${options.item ? '写真の服を編集' : '写真から追加'}</h2></div><button type="button" class="icon-button" id="photo-close" aria-label="写真編集を閉じる">×</button></div>
<p class="photo-intro">服単体の正面写真から、色・柄・プリントを3Dの服に。平置き・ハンガー・商品写真に対応します。<br>写真はこの端末で処理します。初回の自動推定にはモデルのダウンロードが必要です。</p>
<div class="photo-layout"><section class="photo-workspace" aria-label="写真の編集">
<div class="photo-tabs"><button type="button" data-side="front" aria-pressed="true">正面</button><button type="button" data-side="back" aria-pressed="false">背面（任意）</button></div>
<label class="photo-upload">写真を選ぶ・差し替える<input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG・PNG・WebP / 15 MB以下 / 1枚につき1着</small></label>
<div class="photo-canvas-wrap"><canvas id="photo-canvas" width="600" height="600" aria-label="写真の背景を消去・復元する編集キャンバス"></canvas><p id="photo-empty">正面の写真を選んでください</p></div>
<div class="photo-tools"><label>編集モード<select id="photo-tool"><option value="erase">背景を消す</option><option value="restore">消した部分を戻す</option><option value="crop">範囲を切り抜く</option></select></label><label>ブラシの太さ<input id="photo-brush" type="range" min="3" max="100" value="28"></label></div>
<div class="photo-button-row"><button type="button" id="photo-auto">背景を自動除去</button><button type="button" id="photo-undo">ひとつ戻す</button><button type="button" id="photo-reset">元の写真に戻す</button><button type="button" id="photo-back-remove" hidden>背面写真を外す</button></div>
<p class="photo-help">写真をなぞって補正できます。「範囲を切り抜く」は残す部分をドラッグで囲みます。元の写真に戻すと、この編集で行った切り抜きと消去を解除します。</p>
<div class="photo-analysis"><p id="photo-status" role="status" aria-live="polite">自動推定を準備しています…</p><progress id="photo-progress" max="100"></progress><div class="photo-button-row"><button type="button" id="photo-classify">種類を推定する</button><button type="button" id="photo-stop">推定を中止</button></div><div id="photo-candidates" class="photo-candidates"></div></div>
</section><section class="photo-settings" aria-label="3Dプレビューと服の設定">
<div id="photo-scene" class="photo-scene"></div><div class="photo-button-row"><button type="button" id="photo-view-front">正面を見る</button><button type="button" id="photo-view-back">背面を見る</button></div><p class="photo-help">ドラッグで回転。写真のない背面と側面は基本色になります。</p>
<label>服の名前<input id="photo-name" maxlength="40" placeholder="例：プリントTシャツ"></label><div class="form-row"><label>服の形<select id="photo-template">${optionsHTML}</select></label><label>基本色<input id="photo-color" type="color" value="#b9b9b9"></label></div>
<button type="button" id="photo-extract" class="text-button">写真から基本色を取り直す</button>
<fieldset class="photo-placement"><legend>選択中の写真の配置</legend><label>左右<input data-placement="x" type="range" min="-1" max="1" step="0.01" value="0"></label><label>上下<input data-placement="y" type="range" min="-1" max="1" step="0.01" value="0"></label><label>大きさ<input data-placement="scale" type="range" min="0.2" max="3" step="0.01" value="1"></label><label>回転<input data-placement="rotation" type="range" min="-180" max="180" step="1" value="0"></label><button type="button" id="photo-placement-reset">配置をリセット</button></fieldset>
</section></div><p id="photo-error" role="alert"></p><div class="dialog-actions photo-footer"><button type="button" id="photo-cancel" class="text-button">キャンセル</button>${options.remove ? '<button type="button" id="photo-delete" class="danger-button">この服を削除</button>' : ''}<button type="button" id="photo-save" class="primary-button" disabled>${options.item ? '変更を保存' : 'クローゼットに追加'}</button></div>`;
  document.body.append(dialog); dialog.showModal();
  const el = <T extends HTMLElement>(id: string) => dialog.querySelector<T>('#' + id)!;
  const sides: Partial<Record<SideName, Editable>> = {};
  const originals: Partial<Record<SideName, HTMLCanvasElement>> = {};
  let side: SideName = 'front', closed = false, saving = false, loading = false, fileRevision = 0, classifyRevision = 0;
  let worker: Worker | undefined, ready = false, analyzing = false, pendingClassification = false, previewTimer = 0;
  let nameTouched = !!options.item, templateTouched = !!options.item;
  const name = el<HTMLInputElement>('photo-name'), template = el<HTMLSelectElement>('photo-template'), color = el<HTMLInputElement>('photo-color');
  name.value = options.item?.name ?? ''; template.value = options.item?.template ?? 'tee'; color.value = options.item?.color ?? '#b9b9b9';
  const canvas = el<HTMLCanvasElement>('photo-canvas'), ctx = canvas.getContext('2d')!;
  const preview = new ClosetScene(el('photo-scene'), false);
  void preview.ready.catch(() => { if (!closed) error('3Dモデルを読み込めません。接続を確認してもう一度開いてください。'); });
  const error = (message: string) => { el('photo-error').textContent = message; };
  const status = (message: string) => { el('photo-status').textContent = message; };
  const updateButtons = () => {
    el<HTMLButtonElement>('photo-save').disabled = loading || saving || !sides.front;
    el<HTMLButtonElement>('photo-classify').disabled = !sides.front || loading || analyzing;
    el<HTMLButtonElement>('photo-stop').disabled = !worker;
    el<HTMLButtonElement>('photo-undo').disabled = !sides[side]?.undo.length;
    el<HTMLButtonElement>('photo-back-remove').hidden = side !== 'back' || !sides.back;
  };
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const current = sides[side];
    el('photo-empty').hidden = !!current;
    el('photo-empty').textContent = side === 'front' ? '正面の写真を選んでください' : '背面写真は任意です。なければ基本色で表示します。';
    if (current) {
      canvas.width = current.mask.width; canvas.height = current.mask.height;
      ctx.drawImage(current.mask, 0, 0);
    }
    dialog.querySelectorAll<HTMLInputElement>('[data-placement]').forEach(input => { input.value = String(current?.placement[input.dataset.placement as 'x' | 'y' | 'scale' | 'rotation'] ?? (input.dataset.placement === 'scale' ? 1 : 0)); });
    updateButtons();
  }
  function exportSide(current: Editable): PhotoSide {
    if (!current.placement.image) current.placement.image = current.mask.toDataURL('image/png');
    if (!current.placement.source) current.placement.source = current.source.toDataURL('image/webp', .9);
    return { ...current.placement };
  }
  function garment(): Garment {
    const shape = template.value as Garment['template'];
    return { id: options.item?.id ?? 'photo-draft', name: name.value.trim() || `写真の${TEMPLATES[shape].label}`, template: shape, category: TEMPLATES[shape].category, color: color.value, pattern: 'solid',
      photoDesign: sides.front ? { front: exportSide(sides.front), ...(sides.back ? { back: exportSide(sides.back) } : {}) } : undefined,
      createdAt: options.item?.createdAt ?? Date.now() };
  }
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      if (closed) return;
      const g = garment(); preview.setLook(options.body, sides.front ? [g] : []);
    }, 160);
  }
  function framePreview(back = false) {
    const category = TEMPLATES[template.value as Garment['template']].category;
    preview.setView(category === 'shoes' ? 'feet' : category === 'bottom' ? 'lower' : 'upper', false);
    if (back) preview.viewBack();
  }
  function saveUndo(current: Editable) {
    current.undo.push(current.mask.getContext('2d')!.getImageData(0, 0, current.mask.width, current.mask.height));
    if (current.undo.length > 8) current.undo.shift();
  }
  function changed(current: Editable) { current.placement.image = ''; draw(); refreshPreview(); }
  function extract() {
    const current = sides[side]; if (!current) return;
    color.value = dominantColor(current.mask.getContext('2d')!.getImageData(0, 0, current.mask.width, current.mask.height).data); refreshPreview();
  }
  function startWorker() {
    if (worker) return;
    worker = new Worker(new URL('./photo-classifier.worker.ts', import.meta.url), { type: 'module' });
    ready = false; status('自動推定モデルを読み込み中…初回は数分かかることがあります。手動選択でも続けられます。');
    el<HTMLProgressElement>('photo-progress').hidden = false;
    el<HTMLProgressElement>('photo-progress').removeAttribute('value');
    worker.onmessage = event => {
      if (closed) return;
      const data = event.data;
      if (data.type === 'progress') { el<HTMLProgressElement>('photo-progress').value = data.progress; status(`モデルを読み込み中 ${Math.round(data.progress)}%（${data.file}）`); return; }
      if (data.type === 'ready') { ready = true; el<HTMLProgressElement>('photo-progress').hidden = true; status('自動推定の準備ができました。'); if (sides.front && pendingClassification) classify(); }
      if (data.type === 'result' && data.id === classifyRevision) {
        analyzing = false; el<HTMLProgressElement>('photo-progress').hidden = true;
        const candidates = data.candidates as { template: Garment['template']; score: number }[];
        el('photo-candidates').replaceChildren(...candidates.map((candidate, i) => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = `${i + 1}. ${TEMPLATES[candidate.template].label}`;
          button.onclick = () => { template.value = candidate.template; templateTouched = true; suggestName(); framePreview(); refreshPreview(); }; return button;
        }));
        if (!templateTouched && candidates[0]) { template.value = candidates[0].template; suggestName(); framePreview(); refreshPreview(); }
        status('推定候補です。服の形を確認し、違う場合は変更してください。');
      }
      if (data.type === 'error' && (data.id === classifyRevision || data.id === 0)) { stopWorker(); status(data.message); }
      updateButtons();
    };
    worker.onerror = () => { stopWorker(); status('自動推定を利用できません。服の形を選んで続けられます。'); };
    worker.postMessage({ type: 'load', id: 0 }); updateButtons();
  }
  function stopWorker() { worker?.terminate(); worker = undefined; ready = false; analyzing = false; pendingClassification = false; classifyRevision++; el<HTMLProgressElement>('photo-progress').hidden = true; updateButtons(); }
  function classify() {
    if (!sides.front) return;
    pendingClassification = true;
    if (!worker) startWorker();
    if (!ready) { status('モデルの読み込み完了後に推定します。手動で形を選ぶこともできます。'); return; }
    pendingClassification = false;
    const current = sides.front, c = document.createElement('canvas'); c.width = c.height = 224;
    const context = c.getContext('2d')!; context.fillStyle = '#ffffff'; context.fillRect(0, 0, 224, 224);
    const pixels = current.mask.getContext('2d')!.getImageData(0, 0, current.mask.width, current.mask.height);
    const bounds = foregroundBounds(pixels.data, pixels.width, pixels.height);
    if (!bounds) { error('服の部分が残っていません。消した部分を戻してください。'); return; }
    const scale = 208 / Math.max(bounds.width, bounds.height), w = bounds.width * scale, h = bounds.height * scale;
    context.drawImage(current.mask, bounds.x, bounds.y, bounds.width, bounds.height, (224 - w) / 2, (224 - h) / 2, w, h);
    const input = context.getImageData(0, 0, 224, 224); analyzing = true; status('服の形を端末内で解析しています…');
    worker!.postMessage({ type: 'classify', id: ++classifyRevision, pixels: input.data, width: 224, height: 224 }, [input.data.buffer]); updateButtons();
  }
  function suggestName() { if (!nameTouched) name.value = `写真の${TEMPLATES[template.value as Garment['template']].label}`; }
  async function loadFile() {
    const file = el<HTMLInputElement>('photo-file').files?.[0]; if (!file) return;
    const targetSide = side, revision = ++fileRevision; loading = true; updateButtons(); error('');
    if (targetSide === 'front') { classifyRevision++; analyzing = false; el('photo-candidates').replaceChildren(); }
    try {
      const source = await readPhoto(file); if (closed || revision !== fileRevision) return;
      originals[targetSide] = canvasCopy(source);
      const mask = canvasCopy(source), context = mask.getContext('2d')!, pixels = context.getImageData(0, 0, mask.width, mask.height);
      const removed = removeBackground(pixels.data, mask.width, mask.height);
      const bounds = foregroundBounds(removed, mask.width, mask.height);
      if (bounds && bounds.width * bounds.height > mask.width * mask.height * .02) {
        context.putImageData(new ImageData(removed, mask.width, mask.height), 0, 0);
        const crop = (input: HTMLCanvasElement) => { const c = document.createElement('canvas'); c.width = bounds.width; c.height = bounds.height; c.getContext('2d')!.drawImage(input, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height); return c; };
        sides[targetSide] = { source: crop(source), mask: crop(mask), placement: defaultPlacement(), undo: [] };
      } else { sides[targetSide] = { source, mask: canvasCopy(source), placement: defaultPlacement(), undo: [] }; error('背景を分離できませんでした。背景を手動で消去するか、服の範囲を切り抜いてください。'); }
      if (targetSide === 'front') { const m = sides.front!.mask; color.value = dominantColor(m.getContext('2d')!.getImageData(0, 0, m.width, m.height).data); suggestName(); classify(); }
      draw(); framePreview(targetSide === 'back'); refreshPreview();
    } catch (e) { error(e instanceof Error ? e.message : '写真を読み込めませんでした。'); }
    finally { if (!closed && revision === fileRevision) { loading = false; updateButtons(); el<HTMLInputElement>('photo-file').value = ''; } }
  }
  let stroke: { x: number; y: number } | undefined, last: { x: number; y: number } | undefined;
  const point = (event: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * canvas.width / r.width, y: (event.clientY - r.top) * canvas.height / r.height }; };
  function brush(p: { x: number; y: number }) {
    const current = sides[side]; if (!current) return;
    const context = current.mask.getContext('2d')!, radius = Number(el<HTMLInputElement>('photo-brush').value) * canvas.width / canvas.clientWidth / 2;
    const from = last ?? p, steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, radius / 3)));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + (p.x - from.x) * i / steps, y = from.y + (p.y - from.y) * i / steps;
      context.save(); context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip(); context.clearRect(0, 0, canvas.width, canvas.height);
      if (el<HTMLSelectElement>('photo-tool').value === 'restore') context.drawImage(current.source, 0, 0);
      context.restore();
    }
    last = p; current.placement.image = ''; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(current.mask, 0, 0);
  }
  canvas.onpointerdown = event => { if (!sides[side] || loading) return; canvas.setPointerCapture(event.pointerId); stroke = point(event); last = undefined; saveUndo(sides[side]!); if (el<HTMLSelectElement>('photo-tool').value !== 'crop') brush(stroke); };
  canvas.onpointermove = event => {
    if (!stroke) return; const p = point(event);
    if (el<HTMLSelectElement>('photo-tool').value !== 'crop') brush(p);
    else { draw(); ctx.strokeStyle = '#e60012'; ctx.lineWidth = 3 * canvas.width / canvas.clientWidth; ctx.strokeRect(stroke.x, stroke.y, p.x - stroke.x, p.y - stroke.y); }
  };
  function endStroke(event: PointerEvent) {
    if (!stroke) return; const current = sides[side]!;
    if (el<HTMLSelectElement>('photo-tool').value === 'crop' && event.type !== 'pointercancel') {
      const p = point(event), x = Math.max(0, Math.floor(Math.min(p.x, stroke.x))), y = Math.max(0, Math.floor(Math.min(p.y, stroke.y)));
      const width = Math.min(canvas.width - x, Math.round(Math.abs(p.x - stroke.x))), height = Math.min(canvas.height - y, Math.round(Math.abs(p.y - stroke.y)));
      if (width > 8 && height > 8) {
        const crop = (input: HTMLCanvasElement) => { const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d')!.drawImage(input, x, y, width, height, 0, 0, width, height); return c; };
        current.mask = crop(current.mask); current.source = crop(current.source); current.placement.source = ''; current.undo = [];
      }
    }
    stroke = last = undefined; changed(current);
  }
  canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke;
  dialog.querySelectorAll<HTMLButtonElement>('[data-side]').forEach(button => { button.onclick = () => { side = button.dataset.side as SideName; dialog.querySelectorAll('[data-side]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); draw(); framePreview(side === 'back'); }; });
  el<HTMLInputElement>('photo-file').onchange = () => { void loadFile(); };
  el('photo-auto').onclick = () => { const c = sides[side]; if (!c) return; saveUndo(c); const context = c.mask.getContext('2d')!, p = context.getImageData(0, 0, c.mask.width, c.mask.height); context.putImageData(new ImageData(removeBackground(p.data, p.width, p.height), p.width, p.height), 0, 0); changed(c); };
  el('photo-undo').onclick = () => { const c = sides[side], previous = c?.undo.pop(); if (c && previous) { c.mask.getContext('2d')!.putImageData(previous, 0, 0); changed(c); } };
  el('photo-reset').onclick = () => { const c = sides[side], source = originals[side]; if (!c || !source) return; c.source = canvasCopy(source); c.mask = canvasCopy(source); c.undo = []; c.placement.source = ''; changed(c); };
  el('photo-back-remove').onclick = () => { delete sides.back; delete originals.back; draw(); refreshPreview(); };
  el('photo-extract').onclick = extract;
  el('photo-classify').onclick = classify;
  el('photo-stop').onclick = () => { stopWorker(); status('推定を中止しました。服の形を選んで続けられます。'); };
  name.oninput = () => { nameTouched = true; };
  template.onchange = () => { templateTouched = true; suggestName(); framePreview(); refreshPreview(); };
  color.oninput = refreshPreview;
  dialog.querySelectorAll<HTMLInputElement>('[data-placement]').forEach(input => { input.oninput = () => { const c = sides[side]; if (c) { c.placement[input.dataset.placement as 'x' | 'y' | 'scale' | 'rotation'] = Number(input.value); refreshPreview(); } }; });
  el('photo-placement-reset').onclick = () => { const c = sides[side]; if (c) { Object.assign(c.placement, { x: 0, y: 0, scale: 1, rotation: 0 }); draw(); refreshPreview(); } };
  el('photo-view-front').onclick = () => framePreview(); el('photo-view-back').onclick = () => framePreview(true);
  const close = () => { if (!saving) dialog.close(); };
  el('photo-close').onclick = close; el('photo-cancel').onclick = close;
  dialog.oncancel = event => { if (saving) event.preventDefault(); };
  dialog.onclose = () => { closed = true; fileRevision++; stopWorker(); clearTimeout(previewTimer); preview.dispose(); dialog.remove(); };
  el('photo-save').onclick = async () => {
    if (!sides.front || saving || loading) return;
    for (const c of Object.values(sides)) { const p = c.mask.getContext('2d')!.getImageData(0, 0, c.mask.width, c.mask.height); if (!foregroundBounds(p.data, p.width, p.height)) { error('服の部分が残っていません。消した部分を戻してください。'); return; } }
    if (!name.value.trim()) { error('服の名前を入力してください。'); name.focus(); return; }
    saving = true; updateButtons(); error('');
    try { const g = garment(); g.id = options.item?.id ?? crypto.randomUUID(); if (await options.save(g)) dialog.close(); else error('保存できませんでした。端末の空き容量を確認して再試行してください。'); }
    catch { error('保存できませんでした。もう一度お試しください。'); }
    finally { saving = false; if (!closed) updateButtons(); }
  };
  if (options.remove) el('photo-delete').onclick = async () => { if (saving || !confirm('この服をクローゼットから削除しますか？')) return; saving = true; updateButtons(); try { if (await options.remove!()) dialog.close(); else error('削除できませんでした。'); } finally { saving = false; if (!closed) updateButtons(); } };
  startWorker(); updateButtons();
  if (options.item?.photoDesign) {
    loading = true; updateButtons();
    try {
      for (const key of ['front', 'back'] as const) {
        const saved = options.item.photoDesign[key]; if (!saved) continue;
        const [source, mask] = await Promise.all([decode(saved.source), decode(saved.image)]); if (closed) return;
        originals[key] = canvasCopy(source); sides[key] = { source, mask, placement: { ...saved }, undo: [] };
      }
      draw(); refreshPreview(); framePreview();
    } catch { error('保存した写真を開けませんでした。写真を選び直してください。'); }
    finally { loading = false; if (!closed) updateButtons(); }
  } else { draw(); refreshPreview(); framePreview(); }
}
