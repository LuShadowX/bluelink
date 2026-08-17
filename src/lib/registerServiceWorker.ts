/**
 * Register the offline worker.
 *
 * Deliberately kept out of the render path: an install failure must never stop
 * the app from starting, and on an unsupported or insecure origin this is simply
 * a no-op. Registration waits for load so it never competes with the first
 * edition for bandwidth.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  // Service workers need a secure context; localhost counts, file:// does not.
  if (!window.isSecureContext) return

  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI)
    navigator.serviceWorker.register(url.toString(), { scope: './' }).catch(() => {
      // Nothing to do — the app works fine without offline support.
    })
  })
}
