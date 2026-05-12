export async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] unsupported');
    return;
  }

  try {
    await navigator.serviceWorker.register('./sw.js');
    console.log('[SW] registered');
  } catch (err) {
    console.error('[SW] registration failed', err);
  }
}
