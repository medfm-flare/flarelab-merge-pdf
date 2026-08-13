# FLARE-Lab / merge_pdf

A local web app that merges PDF files into one, in the spirit of
[iLovePDF's merge tool](https://www.ilovepdf.com/merge_pdf) — except **nothing is
uploaded**. There is no backend: files are read, previewed and merged entirely
in the browser tab, so receipts, statements and manuscripts never leave the
machine.

## Run it

```bash
./serve.sh          # http://localhost:8080, opens your browser
./serve.sh 9000     # pick another port
```

`serve.sh` is just `python3 -m http.server` over this directory. Any static
server works (`npx serve .`, nginx, GitHub Pages, S3 — no build step, no
dependencies to install).

> Serve over HTTP rather than opening `index.html` as a `file://` URL. Browsers
> refuse to start the pdf.js worker from `file://`, so thumbnails silently fall
> back to a generic PDF icon. Merging still works either way.

## What it does

| Feature | Notes |
| --- | --- |
| Add files | Button, click-to-browse, or drop anywhere on the page. Multi-select. |
| Preview | First page of each PDF, rendered locally with pdf.js. |
| Order | Drag cards, use the ◀ ▶ buttons, `Sort A–Z` (natural order, so `2-x` sorts before `10-x`), or `Reverse`. |
| Page ranges | Per file: `all` (default), `1-3`, `2,5,9-`, `-4`. Descending (`5-1`) reverses those pages. Invalid input is flagged and that file is skipped, not fatal. |
| Rotation | Per file, 90° per click, applied on top of each page's existing rotation. |
| Output name | Free-text; illegal filename characters are replaced. |
| Double-sided padding | Optional blank page after any file ending on an odd page, so every file starts on a fresh sheet when printed duplex. |
| Metadata | Optionally carries title/author/subject from the first file; `Creator` is stamped as `FLARE-Lab/merge_pdf`. |
| Themes | Follows the OS light/dark preference, with a manual toggle that sticks. |

Unreadable or password-protected files are marked on their card and excluded
from the merge — the rest still merge.

## Layout

```
index.html              markup for the three stages: pick → arrange → done
assets/styles.css       light/dark theme, responsive down to 390px
assets/app.js           UI state: file list, card grid, reordering, merge flow
assets/pdf-core.js      PDF logic only, no DOM (page ranges, rotation, merge)
assets/thumbs.js        pdf.js thumbnails, best-effort with graceful fallback
vendor/                 pdf-lib 1.17.1 + pdf.js 3.11.174, vendored locally
serve.sh                local static server
test/merge.test.mjs     Node smoke test for pdf-core.js
```

Nothing is fetched from a CDN at runtime, so the app works fully offline.

## Tests

```bash
node test/merge.test.mjs           # uses the PDFs in the parent directory
node test/merge.test.mjs /some/dir # or point it at your own
```

Covers page-range parsing (22 assertions) and a real merge: page counts,
padding, rotation, and re-reading the written file. The UI itself was verified
against headless Chromium — upload, thumbnail rendering, reordering, ranges,
rotation, removal, merge, blob download and page count of the result, theme
toggle, and no horizontal overflow at 390px.

## Limits

- Everything is held in memory, so very large batches are bounded by available
  RAM (hundreds of MB of PDFs is fine; multi-GB is not).
- `Producer` in the output metadata stays `pdf-lib` — that string is written by
  the library's serializer and is not overridable.
- Merging preserves page content, not document-level interactive structure:
  bookmarks/outlines are dropped, and AcroForm form fields lose their wiring
  (they may still render, but do not stay fillable).
