/**
 * FLARE-Lab / merge_pdf — UI controller.
 *
 * Owns the file list, the card grid (drag-to-reorder, page ranges, rotation)
 * and the merge/download flow. All PDF work is delegated to pdf-core.js.
 */

import { probe, mergePdfs, countSelected, cleanMessage } from './pdf-core.js';
import { renderThumbnail, thumbsAvailable } from './thumbs.js';

const $ = (id) => document.getElementById(id);
const el = {
  stageIntro: $('stageIntro'), stageWork: $('stageWork'), stageDone: $('stageDone'),
  dropzone: $('dropzone'), pickBtn: $('pickBtn'), fileInput: $('fileInput'),
  grid: $('fileGrid'), fileCount: $('fileCount'), totalPages: $('totalPages'),
  addMoreBtn: $('addMoreBtn'), sortNameBtn: $('sortNameBtn'), reverseBtn: $('reverseBtn'),
  clearBtn: $('clearBtn'), outName: $('outName'), optBlankPage: $('optBlankPage'),
  optKeepMeta: $('optKeepMeta'), summary: $('summary'), mergeBtn: $('mergeBtn'),
  overlay: $('overlay'), overlayText: $('overlayText'), overlayBar: $('overlayBar'),
  downloadBtn: $('downloadBtn'), doneMeta: $('doneMeta'), toasts: $('toasts'),
  backToFilesBtn: $('backToFilesBtn'), startOverBtn: $('startOverBtn'),
  themeToggle: $('themeToggle'),
};

/** @type {Array<{id:string,file:File,pageCount:number,range:string,rotation:number,error:string|null}>} */
let items = [];
let seq = 0;
let cards = new Map(); // id -> <li>
let dragId = null;
let lastUrl = null;

/* ── helpers ──────────────────────────────────────────────────────────── */

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};

const naturalCmp = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  el.toasts.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'err' ? 6000 : 3200);
}

function icon(paths, size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round">${paths}</svg>`;
}

function showStage(name) {
  el.stageIntro.hidden = name !== 'intro';
  el.stageWork.hidden = name !== 'work';
  el.stageDone.hidden = name !== 'done';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── file intake ──────────────────────────────────────────────────────── */

const looksLikePdf = (file) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  const pdfs = incoming.filter(looksLikePdf);
  const rejected = incoming.length - pdfs.length;
  if (rejected) toast(`Skipped ${rejected} non-PDF file${rejected > 1 ? 's' : ''}.`, 'err');
  if (!pdfs.length) return;

  pdfs.sort((a, b) => naturalCmp(a.name, b.name));

  const added = [];
  for (const file of pdfs) {
    const item = {
      id: `f${++seq}`, file, pageCount: 0, range: '', rotation: 0, error: null,
    };
    try {
      const info = await probe(file);
      item.pageCount = info.pageCount;
      if (!info.pageCount) item.error = 'no pages';
    } catch (err) {
      item.error = cleanMessage(err);
    }
    items.push(item);
    added.push(item);
  }

  showStage('work');
  syncGrid();
  const broken = added.filter((i) => i.error);
  if (broken.length) {
    toast(`${broken.length} file${broken.length > 1 ? 's' : ''} could not be read and will be skipped.`, 'err');
  }
  for (const item of added) loadThumb(item);
}

async function loadThumb(item) {
  const card = cards.get(item.id);
  if (!card) return;
  const slot = card.querySelector('.thumb');
  if (item.error || !thumbsAvailable()) { paintFallback(slot, item); return; }

  const canvas = await renderThumbnail(item.file, 240);
  if (!cards.has(item.id)) return; // removed while rendering
  if (canvas) {
    slot.replaceChildren(canvas);
  } else {
    paintFallback(slot, item);
  }
}

function paintFallback(slot, item) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb-fallback';
  wrap.innerHTML = `${icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>', 30)}
    <span>${item.error ? 'unreadable' : 'PDF'}</span>`;
  slot.replaceChildren(wrap);
}

/* ── card rendering ───────────────────────────────────────────────────── */

function buildCard(item) {
  const li = document.createElement('li');
  li.className = 'card';
  li.dataset.id = item.id;
  li.draggable = true;
  li.innerHTML = `
    <span class="card-index"></span>
    <button class="card-remove" type="button" title="Remove file" aria-label="Remove file">
      ${icon('<path d="M6 6l12 12M18 6 6 18"/>', 13)}
    </button>
    <div class="thumb"><div class="thumb-skeleton"></div></div>
    <div class="card-body">
      <div class="card-name"></div>
      <div class="card-meta"></div>
      <div class="card-ctl">
        <button class="mini act-left" type="button" title="Move earlier" aria-label="Move earlier">◀</button>
        <button class="mini act-right" type="button" title="Move later" aria-label="Move later">▶</button>
        <button class="mini act-rot" type="button" title="Rotate 90° clockwise" aria-label="Rotate">
          ${icon('<path d="M20 10a8 8 0 1 0-2.3 6"/><path d="M20 4.5V10h-5.5"/>', 13)}
        </button>
        <input class="range-input act-range" type="text" placeholder="all pages"
               spellcheck="false" autocomplete="off"
               title="Pages to include, e.g. 1-3, 5, 8-">
      </div>
    </div>`;

  li.querySelector('.card-remove').addEventListener('click', () => removeItem(item.id));
  li.querySelector('.act-left').addEventListener('click', () => move(item.id, -1));
  li.querySelector('.act-right').addEventListener('click', () => move(item.id, 1));
  li.querySelector('.act-rot').addEventListener('click', () => rotate(item.id));

  const range = li.querySelector('.act-range');
  range.addEventListener('input', () => {
    item.range = range.value;
    updateCard(item);
    updateSummary();
  });
  // Typing in the range box must not start a card drag.
  range.addEventListener('pointerdown', () => { li.draggable = false; });
  range.addEventListener('blur', () => { li.draggable = true; });

  li.addEventListener('dragstart', (ev) => {
    dragId = item.id;
    li.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', item.id);
  });
  li.addEventListener('dragend', () => {
    dragId = null;
    li.classList.remove('dragging');
    for (const c of cards.values()) c.classList.remove('drop-target');
  });
  li.addEventListener('dragover', (ev) => {
    if (!dragId || dragId === item.id) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', (ev) => {
    if (!dragId || dragId === item.id) return;
    ev.preventDefault();
    ev.stopPropagation();
    li.classList.remove('drop-target');
    moveBefore(dragId, item.id);
  });

  return li;
}

function updateCard(item) {
  const card = cards.get(item.id);
  if (!card) return;
  const index = items.indexOf(item);

  card.querySelector('.card-index').textContent = String(index + 1);
  card.querySelector('.card-name').textContent = item.file.name;
  card.querySelector('.card-name').title = item.file.name;
  card.querySelector('.act-left').disabled = index === 0;
  card.querySelector('.act-right').disabled = index === items.length - 1;

  const rotBtn = card.querySelector('.act-rot');
  rotBtn.classList.toggle('on', item.rotation % 360 !== 0);
  rotBtn.title = item.rotation % 360 ? `Rotated ${item.rotation % 360}° — click for more` : 'Rotate 90° clockwise';

  const rangeInput = card.querySelector('.act-range');
  if (rangeInput.value !== item.range) rangeInput.value = item.range;
  rangeInput.disabled = Boolean(item.error);

  const selected = item.error ? null : countSelected(item.range, item.pageCount);
  rangeInput.classList.toggle('bad', selected === null && !item.error);
  card.classList.toggle('is-error', Boolean(item.error) || selected === null);

  const bits = [];
  if (item.error) {
    bits.push(`<span class="err">${item.error}</span>`);
  } else if (selected === null) {
    bits.push('<span class="err">bad page range</span>');
  } else if (selected === item.pageCount) {
    bits.push(`${item.pageCount} page${item.pageCount > 1 ? 's' : ''}`);
  } else {
    bits.push(`${selected} of ${item.pageCount} pages`);
  }
  bits.push('·', fmtBytes(item.file.size));
  if (item.rotation % 360) bits.push('·', `${item.rotation % 360}°`);
  card.querySelector('.card-meta').innerHTML = bits.join(' ');
}

/** Re-attach cards in list order, creating/removing as needed. */
function syncGrid() {
  if (!items.length) {
    cards.clear();
    el.grid.replaceChildren();
    showStage('intro');
    updateSummary();
    return;
  }

  for (const id of [...cards.keys()]) {
    if (!items.some((i) => i.id === id)) {
      cards.get(id).remove();
      cards.delete(id);
    }
  }
  for (const item of items) {
    let card = cards.get(item.id);
    if (!card) {
      card = buildCard(item);
      cards.set(item.id, card);
    }
    el.grid.append(card); // append moves existing nodes, keeping thumbnails
  }
  for (const item of items) updateCard(item);
  updateSummary();
}

/* ── list mutations ───────────────────────────────────────────────────── */

function removeItem(id) {
  items = items.filter((i) => i.id !== id);
  syncGrid();
}

function move(id, delta) {
  const from = items.findIndex((i) => i.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return;
  [items[from], items[to]] = [items[to], items[from]];
  syncGrid();
  cards.get(id)?.querySelector(delta < 0 ? '.act-left' : '.act-right')?.focus();
}

function moveBefore(sourceId, targetId) {
  const from = items.findIndex((i) => i.id === sourceId);
  const to = items.findIndex((i) => i.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  syncGrid();
}

function rotate(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  item.rotation = (item.rotation + 90) % 360;
  updateCard(item);
}

/* ── summary + merge ──────────────────────────────────────────────────── */

function plan() {
  const usable = items.filter((i) => !i.error && countSelected(i.range, i.pageCount) !== null);
  let pages = usable.reduce((n, i) => n + countSelected(i.range, i.pageCount), 0);
  if (el.optBlankPage.checked) {
    pages += usable.filter((i) => countSelected(i.range, i.pageCount) % 2 === 1).length;
  }
  return { usable, pages, skipped: items.length - usable.length };
}

function updateSummary() {
  const { usable, pages, skipped } = plan();
  el.fileCount.textContent = String(items.length);
  el.totalPages.textContent = items.length
    ? `${pages} page${pages === 1 ? '' : 's'} in output`
    : '';

  const rows = [
    `<div class="row"><span>Files merged</span><b>${usable.length}</b></div>`,
    `<div class="row"><span>Output pages</span><b>${pages}</b></div>`,
  ];
  if (skipped) {
    rows.push(`<div class="row"><span>Skipped</span><b style="color:var(--danger)">${skipped}</b></div>`);
  }
  el.summary.innerHTML = rows.join('');
  el.mergeBtn.disabled = usable.length < 1;
  el.mergeBtn.title = usable.length < 2 && usable.length === 1
    ? 'Merging a single file will just rewrite it — add another for a real merge.'
    : '';
}

function outputFilename() {
  const raw = (el.outName.value || 'merged').trim().replace(/[\\/:*?"<>|]/g, '_');
  const base = raw.replace(/\.pdf$/i, '') || 'merged';
  return `${base}.pdf`;
}

async function runMerge() {
  const { usable, skipped } = plan();
  if (!usable.length) { toast('Nothing to merge.', 'err'); return; }
  if (skipped) toast(`${skipped} unusable file${skipped > 1 ? 's' : ''} skipped.`);

  el.overlay.hidden = false;
  el.overlayBar.style.width = '0%';
  el.overlayText.textContent = 'Preparing…';

  try {
    const started = performance.now();
    const { bytes, pageCount } = await mergePdfs(
      usable,
      { padToEven: el.optBlankPage.checked, keepMetadata: el.optKeepMeta.checked, title: outputFilename() },
      (done, total, name) => {
        el.overlayBar.style.width = `${Math.round((done / total) * 100)}%`;
        el.overlayText.textContent = done >= total ? 'Writing file…' : `Merging ${done + 1}/${total} — ${name}`;
      },
    );

    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);

    const name = outputFilename();
    el.downloadBtn.href = lastUrl;
    el.downloadBtn.download = name;
    el.doneMeta.textContent =
      `${name} — ${pageCount} page${pageCount === 1 ? '' : 's'}, ${fmtBytes(blob.size)}, ` +
      `from ${usable.length} file${usable.length === 1 ? '' : 's'} in ${((performance.now() - started) / 1000).toFixed(1)}s`;

    showStage('done');
    toast('Merge complete.', 'ok');
  } catch (err) {
    toast(`Merge failed: ${cleanMessage(err)}`, 'err');
  } finally {
    el.overlay.hidden = true;
  }
}

/* ── wiring ───────────────────────────────────────────────────────────── */

el.pickBtn.addEventListener('click', (ev) => { ev.stopPropagation(); el.fileInput.click(); });
el.addMoreBtn.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.fileInput.click(); }
});

el.fileInput.addEventListener('change', async () => {
  // Copy first: clearing `value` (so re-picking the same file re-fires change)
  // empties the live FileList.
  const picked = Array.from(el.fileInput.files);
  el.fileInput.value = '';
  await addFiles(picked);
});

el.sortNameBtn.addEventListener('click', () => {
  items.sort((a, b) => naturalCmp(a.file.name, b.file.name));
  syncGrid();
});
el.reverseBtn.addEventListener('click', () => { items.reverse(); syncGrid(); });
el.clearBtn.addEventListener('click', () => {
  if (items.length > 1 && !confirm(`Remove all ${items.length} files?`)) return;
  items = [];
  syncGrid();
});

el.optBlankPage.addEventListener('change', updateSummary);
el.mergeBtn.addEventListener('click', runMerge);
el.backToFilesBtn.addEventListener('click', () => showStage(items.length ? 'work' : 'intro'));
el.startOverBtn.addEventListener('click', () => {
  items = [];
  el.outName.value = 'merged';
  syncGrid();
});

/* Drag-and-drop anywhere on the page adds files (and stops the browser from
   navigating away to the dropped PDF). Card reordering is handled per-card. */
let dragDepth = 0;
document.addEventListener('dragenter', (ev) => {
  if (dragId || !ev.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  el.dropzone.classList.add('is-over');
});
document.addEventListener('dragleave', () => {
  if (dragId) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.dropzone.classList.remove('is-over');
});
document.addEventListener('dragover', (ev) => {
  if (dragId || !ev.dataTransfer?.types?.includes('Files')) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('drop', async (ev) => {
  if (dragId || !ev.dataTransfer?.files?.length) return;
  ev.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.remove('is-over');
  await addFiles(ev.dataTransfer.files);
});

/* Theme: remember the explicit choice, otherwise follow the OS. */
const savedTheme = localStorage.getItem('flare-merge-theme');
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.dataset.theme = savedTheme;
}
el.themeToggle.addEventListener('click', () => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme;
  const now = current === 'dark' ? 'light' : current === 'light' ? 'dark' : (dark ? 'light' : 'dark');
  document.documentElement.dataset.theme = now;
  localStorage.setItem('flare-merge-theme', now);
});

window.addEventListener('beforeunload', () => { if (lastUrl) URL.revokeObjectURL(lastUrl); });

updateSummary();
if (!window.PDFLib) {
  toast('pdf-lib did not load — check that vendor/pdf-lib.min.js exists.', 'err');
}
