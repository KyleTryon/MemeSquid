import { pipeline, env, PretrainedConfig } from '@huggingface/transformers';
import type { BackgroundRemovalPipeline, ProgressInfo } from '@huggingface/transformers';

env.allowLocalModels = false;

type BackgroundRemovalWorkerRequest =
  { type: 'INIT' } | { type: 'REMOVE_BG'; data: { imageUrl: string; id: string } };

let segmenter: BackgroundRemovalPipeline | null = null;
const backgroundRemovalConfig = new PretrainedConfig({ model_type: 'birefnet' });

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Background removal failed';

const reportProgress = (progress: ProgressInfo) => {
  self.postMessage({ type: 'PROGRESS', data: progress });
};

const loadSegmenter = (device: 'webgpu' | 'wasm') =>
  pipeline('background-removal', 'briaai/RMBG-1.4', {
    config: backgroundRemovalConfig,
    device,
    progress_callback: reportProgress,
  });

self.onmessage = async (event: MessageEvent<BackgroundRemovalWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'INIT') {
    try {
      segmenter = await loadSegmenter('webgpu');
      self.postMessage({ type: 'INIT_DONE' });
    } catch (webGpuError) {
      console.warn('WebGPU failed, falling back to WASM', webGpuError);
      try {
        segmenter = await loadSegmenter('wasm');
        self.postMessage({ type: 'INIT_DONE' });
      } catch (wasmError) {
        self.postMessage({ type: 'ERROR', data: getErrorMessage(wasmError) });
      }
    }
    return;
  }

  try {
    if (!segmenter) throw new Error('Model not initialized');

    const result = await segmenter(message.data.imageUrl);
    self.postMessage({
      type: 'RESULT',
      data: {
        id: message.data.id,
        maskData: result.data,
        width: result.width,
        height: result.height,
        channels: result.channels,
      },
    });
  } catch (error) {
    self.postMessage({ type: 'ERROR', data: getErrorMessage(error) });
  }
};
