export const readImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The image file could not be read.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The image file could not be read.'));
    reader.onabort = () => reject(new Error('Reading the image file was interrupted.'));
    if (file.type === 'image/svg+xml') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });

export const copyCanvasToClipboard = (canvas: Pick<HTMLCanvasElement, 'toBlob'>): Promise<void> => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard access is unavailable.');
  }

  const image = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The image could not be copied.'));
    }, 'image/png');
  });

  // Register the write during the click; encoding can finish asynchronously.
  // Safari requires user activation when clipboard.write is called.
  void image.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
};

export const downloadImage = (dataUrl: string, filename: string): void => {
  if (
    !dataUrl.startsWith('data:image/') ||
    !dataUrl.slice(dataUrl.indexOf(',') + 1) ||
    !dataUrl.includes(',')
  ) {
    throw new Error('The image could not be exported.');
  }
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
};
