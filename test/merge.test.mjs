/**
 * Node smoke test for the PDF core (no browser needed).
 *   node test/merge.test.mjs [pdf-dir]
 *
 * Shims `window.PDFLib` the way index.html does, then exercises page-range
 * parsing and a real merge over the PDFs in `pdf-dir` (default: parent dir).
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
globalThis.window = { PDFLib: require(join(here, '..', 'vendor', 'pdf-lib.min.js')) };

const { parseRange, countSelected, probe, mergePdfs } = await import('../assets/pdf-core.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failures++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};

/* ── 1. page-range parsing ─────────────────────────────────────────────── */
console.log('\nparseRange');
check('empty = all pages', () => assert.deepEqual(parseRange('', 3), [0, 1, 2]));
check('"all" = all pages', () => assert.deepEqual(parseRange('all', 2), [0, 1]));
check('single page', () => assert.deepEqual(parseRange('2', 4), [1]));
check('closed range', () => assert.deepEqual(parseRange('2-4', 5), [1, 2, 3]));
check('open-ended range', () => assert.deepEqual(parseRange('3-', 4), [2, 3]));
check('open start', () => assert.deepEqual(parseRange('-2', 4), [0, 1]));
check('mixed list', () => assert.deepEqual(parseRange('1,3-4', 5), [0, 2, 3]));
check('whitespace tolerated', () => assert.deepEqual(parseRange(' 1 - 2 , 4 ', 4), [0, 1, 3]));
check('descending range reverses', () => assert.deepEqual(parseRange('3-1', 3), [2, 1, 0]));
check('duplicates preserved', () => assert.deepEqual(parseRange('1,1', 2), [0, 0]));
check('out of range throws', () => assert.throws(() => parseRange('9', 3), /out of range/));
check('zero throws', () => assert.throws(() => parseRange('0', 3), /out of range/));
check('garbage throws', () => assert.throws(() => parseRange('abc', 3), /Bad page/));
check('countSelected returns null on bad input', () => assert.equal(countSelected('7', 3), null));
check('countSelected counts', () => assert.equal(countSelected('1-2', 9), 2));

/* ── 2. real merge ─────────────────────────────────────────────────────── */
const dir = resolve(process.argv[2] || join(here, '..', '..'));
const names = readdirSync(dir).filter((n) => /\.pdf$/i.test(n)).sort();

if (!names.length) {
  console.log(`\nmerge: no PDFs found in ${dir} — skipping`);
} else {
  console.log(`\nmerge  (${names.length} PDFs from ${dir})`);

  // Minimal File stand-in: pdf-core only needs .name, .size and .arrayBuffer().
  const asFile = (name) => {
    const buf = readFileSync(join(dir, name));
    return {
      name,
      size: buf.length,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };

  const files = names.map(asFile);
  const probes = [];
  for (const file of files) {
    try {
      const info = await probe(file);
      probes.push({ file, ...info });
      console.log(`  ok   probe ${file.name} → ${info.pageCount}p`);
    } catch (err) {
      console.log(`  skip probe ${file.name} → ${err.message.split('\n')[0]}`);
    }
  }

  const expected = probes.reduce((n, p) => n + p.pageCount, 0);
  const merged = await mergePdfs(probes.map((p) => ({ file: p.file, range: '', rotation: 0 })), {
    keepMetadata: true,
  });
  check(`page count is the sum of inputs (${expected})`, () =>
    assert.equal(merged.pageCount, expected));
  check('output starts with a PDF header', () =>
    assert.equal(Buffer.from(merged.bytes.slice(0, 5)).toString(), '%PDF-'));

  // First page of each file only + padding + rotation.
  const firstPages = await mergePdfs(
    probes.map((p) => ({ file: p.file, range: '1', rotation: 90 })),
    { padToEven: true },
  );
  check('range "1" yields one page per file, padded to two', () =>
    assert.equal(firstPages.pageCount, probes.length * 2));

  const outDir = join(here, 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'merged.pdf');
  writeFileSync(outPath, merged.bytes);
  console.log(`  ->   wrote ${outPath} (${(merged.bytes.length / 1024).toFixed(0)} KB)`);

  // Re-open the file we just wrote to prove the output is a valid PDF.
  const written = readFileSync(outPath);
  const reread = await probe({
    name: 'merged.pdf',
    size: written.length,
    arrayBuffer: async () => written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength),
  });
  check(`re-read merged output from disk → ${reread.pageCount}p`, () =>
    assert.equal(reread.pageCount, expected));
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
