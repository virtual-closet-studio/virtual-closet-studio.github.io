import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
// A single WASM thread works on GitHub Pages without cross-origin isolation.
env.backends.onnx.wasm!.numThreads = 1;
const labels = {
  tee: 'a short sleeve T-shirt', jacket: 'a hooded sweatshirt or hoodie', pants: 'sweatpants or joggers',
  skirt: 'a skirt', boots: 'leather boots', sneakers: 'sneakers or trainers', blazer: 'a tailored blazer jacket',
  shirt: 'a button-up collared shirt', cargo: 'cargo pants with large side pockets',
};
let classifier: ReturnType<typeof pipeline<'zero-shot-image-classification'>> | undefined;
function load() {
  return classifier ??= pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
    dtype: 'q8', device: 'wasm', revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    progress_callback: (progress) => {
      if (progress.status === 'progress') postMessage({ type: 'progress', file: progress.file, progress: progress.progress });
    },
  }).catch(error => { classifier = undefined; throw error; });
}
self.onmessage = async (event: MessageEvent<{ type: 'load' | 'classify'; id: number; pixels?: Uint8ClampedArray; width?: number; height?: number }>) => {
  const { id, type, pixels, width, height } = event.data;
  try {
    const model = await load();
    if (type === 'load') { postMessage({ type: 'ready', id }); return; }
    const result = await model(new RawImage(pixels!, width!, height!, 4), Object.values(labels));
    const candidates = result.slice(0, 3).map(item => ({ template: Object.keys(labels).find(key => labels[key as keyof typeof labels] === item.label), score: item.score }));
    postMessage({ type: 'result', id, candidates });
  } catch { postMessage({ type: 'error', id, message: '自動推定を利用できません。服の形を選んで続けられます。' }); }
};
