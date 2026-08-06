import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("fund product search also matches top-held stocks", async () => {
  const patch = spawnSync(process.execPath, ["scripts/apply-fund-product-search-patch.mjs"], { encoding: "utf8" });
  assert.equal(patch.status, 0, patch.stderr || patch.stdout);
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /搜索基金代码、名称、经理或重仓股票/);
  assert.match(source, /product\.holdings\.find/);
  assert.match(source, /fundStockMatches\.has\(item\.code\)/);
  assert.match(source, /重仓股票匹配基金/);
  assert.match(source, /fund-stock-hit/);
});
