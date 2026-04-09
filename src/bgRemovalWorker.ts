import { pipeline, env } from '@huggingface/transformers';

// Skip local model check since we are running in browser
env.allowLocalModels = false;

let segmenter: any = null;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === 'INIT') {
    try {
      segmenter = await pipeline('background-removal', 'briaai/RMBG-1.4', {
        config: { model_type: 'birefnet' },
        device: 'webgpu',
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'PROGRESS', data: progress });
        }
      });
      self.postMessage({ type: 'INIT_DONE' });
    } catch (err) {
      console.warn("WebGPU failed, falling back to WASM", err);
      try {
        segmenter = await pipeline('background-removal', 'briaai/RMBG-1.4', {
          config: { model_type: 'birefnet' },
          device: 'wasm',
          progress_callback: (progress: any) => {
            self.postMessage({ type: 'PROGRESS', data: progress });
          }
        });
        self.postMessage({ type: 'INIT_DONE' });
      } catch (err2: any) {
        self.postMessage({ type: 'ERROR', data: err2.message });
      }
    }
  } else if (type === 'REMOVE_BG') {
    try {
      const { imageUrl, id } = data;
      
      if (!segmenter) {
        throw new Error("Model not initialized");
      }

      // Run background removal
      const result = await segmenter(imageUrl);

      // result is a RawImage with 4 channels (RGBA) for background-removal pipeline
      let maskImage: any = null;
      if (Array.isArray(result)) {
        const fg = result.find((r: any) => r.label === 'foreground' || r.label === 'LABEL_1') || result[0];
        maskImage = fg.mask || fg;
      } else {
        maskImage = result;
      }

      if (!maskImage) {
        throw new Error("No mask returned from model");
      }

      self.postMessage({
        type: 'RESULT',
        data: {
          id,
          maskData: maskImage.data,
          width: maskImage.width,
          height: maskImage.height,
          channels: maskImage.channels || 1
        }
      });
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', data: err.message });
    }
  }
};
