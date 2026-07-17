import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const snapshot = JSON.parse(await readFile(new URL("app/data/market-index.json", root), "utf8"));
const overviewPath = new URL("public/data/overview/2026-03-31/80000222.json", root);
const overview = JSON.parse(await readFile(overviewPath, "utf8"));

test("the 华夏基金 static trial covers the exact manager roster", () => {
  const company = snapshot.companies.find((item) => item.id === "80000222");
  assert.ok(company, "华夏基金 must exist in the full-market index");
  assert.equal(overview.companyId, company.id);
  assert.equal(overview.period, "2026-03-31");
  assert.equal(overview.quality.failedDownloads, 0);
  assert.equal(overview.quality.completedManagers, company.managers.length);
  assert.equal(overview.quality.fetchedProducts, overview.representativeProductCount);
  assert.deepEqual(Object.keys(overview.managers).sort(), company.managers.map((item) => item.id).sort());
});

test("the static trial contains internally valid disclosed holdings", async () => {
  assert.ok(overview.quality.managersWithHoldings > 0);
  for (const manager of Object.values(overview.managers)) {
    assert.equal(manager.period, overview.period);
    assert.ok(Number.isFinite(manager.managedNav) && manager.managedNav >= 0);
    assert.equal(manager.requested, manager.succeeded + manager.failed);
    assert.ok(manager.holdings.length <= 10);
    assert.ok(manager.holdings.reduce((sum, item) => sum + item.weight, 0) <= 100.01);
    manager.holdings.forEach((holding, index) => {
      assert.equal(holding.rank, index + 1);
      assert.match(holding.stockCode, /^[A-Z0-9.]{1,12}$/i);
      assert.ok(holding.stockName);
      assert.ok(Number.isFinite(holding.marketValue) && holding.marketValue >= 0);
      assert.ok(Number.isFinite(holding.weight) && holding.weight >= 0);
      assert.ok(["新进", "不变", "增持", "减持"].includes(holding.change));
    });
  }
  assert.ok((await stat(overviewPath)).size < 1_000_000, "mobile payload should stay below 1 MB");
});
