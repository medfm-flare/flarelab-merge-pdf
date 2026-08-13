/**
 * FLARE-Lab / merge_pdf — PDF core
 *
 * Pure PDF logic, no DOM. Everything runs locally against `pdf-lib`
 * (exposed as `window.PDFLib` by vendor/pdf-lib.min.js).
 */

const CREATOR = 'FLARE-Lab/merge_pdf';

/** @returns {{PDFDocument: any, degrees: any}} */
function lib() {
  const l = window.PDFLib;
  if (!l) throw new Error('pdf-lib failed to load (vendor/pdf-lib.min.js).');
  return l;
}

/**
 * Load a File into a pdf-lib document.
 * Encrypted-but-readable files are accepted; password-protected ones throw.
 */
export async function loadDocument(file) {
  const { PDFDocument } = lib();
  const bytes = await file.arrayBuffer();
  return PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
}

/** Read the bits the UI needs to describe a file: page count + title. */
export async function probe(file) {
  const doc = await loadDocument(file);
  const first = doc.getPageCount() ? doc.getPage(0).getSize() : null;
  return {
    pageCount: doc.getPageCount(),
    title: safeMeta(() => doc.getTitle()),
    author: safeMeta(() => doc.getAuthor()),
    firstPageSize: first,
  };
}

function safeMeta(fn) {
  try {
    const v = fn();
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Parse a page-range spec into zero-based page indices.
 *
 *   ''  | 'all'      → every page
 *   '1-3, 7, 9-'     → 0,1,2, 6, 8..last
 *   '5-2'            → 4,3,2,1  (descending ranges are honoured)
 *
 * @throws {Error} on malformed input or out-of-bounds pages.
 */
export function parseRange(spec, pageCount) {
  const text = String(spec ?? '').trim().toLowerCase();
  if (!text || text === 'all') {
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  const out = [];
  for (const rawPart of text.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;

    const m = part.match(/^(\d+)?\s*(?:-\s*(\d+)?)?$/);
    if (!m || (!m[1] && !m[2])) throw new Error(`Bad page reference "${part}"`);

    const isRange = part.includes('-');
    const from = m[1] ? Number(m[1]) : 1;
    const to = isRange ? (m[2] ? Number(m[2]) : pageCount) : from;

    for (const n of [from, to]) {
      if (n < 1 || n > pageCount) {
        throw new Error(`Page ${n} is out of range (1-${pageCount})`);
      }
    }
    const step = from <= to ? 1 : -1;
    for (let n = from; step > 0 ? n <= to : n >= to; n += step) out.push(n - 1);
  }

  if (!out.length) throw new Error('No pages selected');
  return out;
}

/** How many pages an item contributes, or null when its range is invalid. */
export function countSelected(spec, pageCount) {
  try {
    return parseRange(spec, pageCount).length;
  } catch {
    return null;
  }
}

/**
 * Merge items into a single PDF.
 *
 * @param {Array<{file: File, range?: string, rotation?: number}>} items
 * @param {{padToEven?: boolean, keepMetadata?: boolean, title?: string}} [options]
 * @param {(done: number, total: number, name: string) => void} [onProgress]
 * @returns {Promise<{bytes: Uint8Array, pageCount: number}>}
 */
export async function mergePdfs(items, options = {}, onProgress = () => {}) {
  if (!items.length) throw new Error('No files to merge');
  const { PDFDocument, degrees } = lib();

  // `updateMetadata: false` stops pdf-lib from stamping its own creator and
  // dates over ours. (Producer is written by pdf-lib's serializer and cannot
  // be overridden — it keeps the library's own attribution.)
  const out = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  out.setCreator(CREATOR);
  out.setCreationDate(now);
  out.setModificationDate(now);
  let firstMeta = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress(i, items.length, item.file.name);

    let src;
    try {
      src = await loadDocument(item.file);
    } catch (err) {
      throw new Error(`Could not read "${item.file.name}": ${cleanMessage(err)}`);
    }

    const total = src.getPageCount();
    if (!total) throw new Error(`"${item.file.name}" has no pages`);

    const indices = parseRange(item.range, total);
    const copied = await out.copyPages(src, indices);

    const spin = ((item.rotation || 0) % 360 + 360) % 360;
    for (const page of copied) {
      if (spin) {
        const base = ((page.getRotation().angle || 0) + spin) % 360;
        page.setRotation(degrees(base));
      }
      out.addPage(page);
    }

    if (options.padToEven && copied.length % 2 === 1) {
      const { width, height } = copied[copied.length - 1].getSize();
      out.addPage([width, height]);
    }

    if (i === 0) {
      firstMeta = {
        title: safeMeta(() => src.getTitle()),
        author: safeMeta(() => src.getAuthor()),
        subject: safeMeta(() => src.getSubject()),
      };
    }

    // Yield to the event loop so the progress UI can paint.
    await new Promise((r) => setTimeout(r, 0));
  }

  if (options.keepMetadata && firstMeta) {
    if (firstMeta.title) out.setTitle(firstMeta.title);
    if (firstMeta.author) out.setAuthor(firstMeta.author);
    if (firstMeta.subject) out.setSubject(firstMeta.subject);
  } else if (options.title) {
    out.setTitle(options.title);
  }

  onProgress(items.length, items.length, 'Writing file');
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pageCount: out.getPageCount() };
}

/** pdf-lib / pdf.js errors are verbose; keep the useful first line. */
export function cleanMessage(err) {
  const raw = (err && err.message) || String(err);
  if (/password|encrypt/i.test(raw)) return 'password-protected PDF';
  if (/no pdf header|invalid pdf|failed to parse/i.test(raw)) return 'not a valid PDF';
  return raw.split('\n')[0].slice(0, 140);
}
