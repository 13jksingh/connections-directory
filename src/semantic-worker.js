import { env, pipeline } from '@huggingface/transformers';
import runtimeModule from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import runtimeWasm from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL(runtimeModule, self.location.href).href,
  wasm: new URL(runtimeWasm, self.location.href).href
};
let extractor;
let documents = [];
let embeddings = [];

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'initialize') {
      self.postMessage({ type: 'progress', message: 'Downloading the on-device search model. This may take a few minutes.' });
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'search') {
      if (!extractor) throw new Error('AI search is not ready.');
      const signature = JSON.stringify(data.documents);
      if (signature !== JSON.stringify(documents)) {
        documents = data.documents;
        embeddings = [];
        for (const document of documents) {
          const output = await extractor(document.text, { pooling: 'mean', normalize: true });
          embeddings.push(Array.from(output.data));
        }
      }
      const query = Array.from((await extractor(data.query, { pooling: 'mean', normalize: true })).data);
      const results = documents.map((document, index) => ({
        id: document.id, match: document.match,
        score: query.reduce((sum, value, i) => sum + value * embeddings[index][i], 0)
      })).filter(result => result.score >= 0.25).sort((a, b) => b.score - a.score);
      self.postMessage({ type: 'results', id: data.id, results });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error.message || 'AI search failed.' });
  }
};
