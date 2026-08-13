/**
 * FLARE-Lab / merge_pdf — first-page thumbnails via pdf.js.
 *
 * Rendering is best-effort: if pdf.js cannot start its worker (for example
 * when the page is opened straight from `file://`), thumbnails are skipped
 * and the UI falls back to an icon card. Merging never depends on this.
 */

const WORKER_SRC = 'vendor/pdf.worker.min.js';
const MAX_CONCURRENT = 2;

let disabled = !window.pdfjsLib;
let active = 0;
const queue = [];

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
}

export function thumbsAvailable() {
  return !disabled;
}

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

/**
 * Render page 1 of `file` into a canvas.
 *
 * @param {File} file
 * @param {number} maxWidth CSS pixels of the longest edge to target.
 * @returns {Promise<HTMLCanvasElement|null>} null when rendering is unavailable.
 */
export async function renderThumbnail(file, maxWidth = 240) {
  if (disabled) return null;
  await acquire();
  let doc = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    doc = await window.pdfjsLib.getDocument({
      data: bytes,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
    }).promise;

    const page = await doc.getPage(1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = page.getViewport({ scale: 1 });
    const scale = (maxWidth / base.width) * dpr;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } catch (err) {
    // A worker/setup failure will hit every file — stop trying after the first.
    if (/worker|import|network|fetch|dynamic/i.test(String(err && err.message))) {
      disabled = true;
    }
    return null;
  } finally {
    if (doc) doc.destroy().catch(() => {});
    release();
  }
}
