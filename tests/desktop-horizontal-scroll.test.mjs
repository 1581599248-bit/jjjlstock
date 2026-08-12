import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop horizontal scrolling is mounted for all wide rails and tables", async () => {
  const [page, css, patch, pkg] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/apply-desktop-horizontal-scroll.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function useDesktopHorizontalScroll\(\)/);
  assert.match(page, /useDesktopHorizontalScroll\(\);/);
  assert.match(page, /\.entity-rail,\.stock-result-rail,\.table-wrap,\.overview-matrix-wrap,\.market-industry-table-wrap/);
  assert.match(page, /addEventListener\("pointerdown"/);
  assert.match(page, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(page, /scrollBy\(\{ left: event\.key === "ArrowRight" \? 180 : -180/);

  assert.match(patch, /document\.createElement\("input"\)/);
  assert.match(patch, /slider\.type = "range"/);
  assert.match(patch, /desktop-horizontal-slider/);
  assert.match(patch, /slider\.addEventListener\("input", onSliderInput\)/);
  assert.match(patch, /element\.scrollLeft = Number\(slider\.value\)/);
  assert.match(patch, /ResizeObserver/);
  assert.match(patch, /MutationObserver/);
  assert.match(patch, /market-industry-table-wrap/);

  assert.match(css, /Desktop horizontal scrolling: wheel, visible scrollbar, mouse drag, and dedicated slider/);
  assert.match(css, /cursor:grab/);
  assert.match(css, /desktop-horizontal-slider/);
  assert.match(css, /accent-color:var\(--orange\)/);
  assert.match(css, /cursor:ew-resize/);

  assert.match(pkg, /apply-desktop-horizontal-scroll\.mjs/);
});
