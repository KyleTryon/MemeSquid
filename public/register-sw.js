if ('serviceWorker' in navigator) {
  const workerUrl = new URL('./sw.js', document.currentScript.src);
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker.register(workerUrl, { updateViaCache: 'none' }).catch(() => {
        console.error('MemeSquid could not enable offline mode.');
      });
    },
    { once: true },
  );
}
