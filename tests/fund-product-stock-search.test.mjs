import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("fund product search also matches top-held stocks", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "fund-search-patch-"));
  let source;
  try {
    await mkdir(path.join(fixture, "app"));
    for (const name of ["page.tsx", "globals.css"]) {
      await cp(new URL(`../app/${name}`, import.meta.url), path.join(fixture, "app", name));
    }
    const script = new URL("../scripts/apply-fund-product-search-patch.mjs", import.meta.url);
    const patch = spawnSync(process.execPath, [script.pathname], { cwd: fixture, encoding: "utf8" });
    assert.equal(patch.status, 0, patch.stderr || patch.stdout);
    source = await readFile(path.join(fixture, "app/page.tsx"), "utf8");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
  assert.match(source, /搜索基金代码、名称、经理或重仓股票/);
  assert.match(source, /product\.holdings\.find/);
  assert.match(source, /fundStockMatches\.has\(item\.code\)/);
  assert.match(source, /重仓股票匹配基金/);
  assert.match(source, /fund-stock-hit/);
});
