type FitWasm = {
  garment_width: (width: number, ease: number) => number;
  garment_length: (height: number, factor: number) => number;
  layer_depth: (layer: number) => number;
};

let wasm: FitWasm | undefined;
async function getWasm(): Promise<FitWasm> {
  if (wasm) return wasm;
  const response = await fetch(`${import.meta.env.BASE_URL}fit.wasm`);
  if (!response.ok) throw new Error('フィット計算を読み込めませんでした');
  const bytes = await response.arrayBuffer();
  const instance = await WebAssembly.instantiate(bytes, {});
  wasm = instance.instance.exports as unknown as FitWasm;
  return wasm;
}

self.onmessage = async (event: MessageEvent<{ id: number; width: number; height: number }>) => {
  const { id, width, height } = event.data;
  try {
    const fit = await getWasm();
    self.postMessage({ id, width: fit.garment_width(width, 1.08), height: fit.garment_length(height, 1), outerWidth: fit.garment_width(width, 1.18), depth: fit.layer_depth(1) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '計算エラー' });
  }
};
