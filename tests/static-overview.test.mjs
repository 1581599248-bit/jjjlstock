import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const snapshot = JSON.parse(await readFile(new URL("app/data/market-index.json", root), "utf8"));
const period = "2026-03-31";
const overviewDirectory = new URL(`public/data/overview/${period}/`, root);
const manifest = JSON.parse(await readFile(new URL("public/data/overview/manifest.json", root), "utf8"));
const allowedChanges = new Set(["\u65b0\u8fdb", "\u4e0d\u53d8", "\u589e\u6301", "\u51cf\u6301"]);

test("the Q1 static market covers every company and manifest entry", async () => {
  const files = (await readdir(overviewDirectory)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
  assert.deepEqual(files, snapshot.companies.map((company) => `${company.id}.json`).sort());
  assert.deepEqual(
    Object.keys(manifest.entries).filter((key) => key.endsWith(`:${period}`)).sort(),
    snapshot.companies.map((company) => `${company.id}:${period}`).sort(),
  );
});

test("every Q1 payload has the exact manager roster and valid holdings", async () => {
  let managerCount = 0;
  for (const company of snapshot.companies) {
    const overviewPath = new URL(`${company.id}.json`, overviewDirectory);
    const overview = JSON.parse(await readFile(overviewPath, "utf8"));
    const managerIds = company.managers.map((manager) => manager.id).sort();
    managerCount += overview.managerCount;
    assert.equal(overview.companyId, company.id);
    assert.equal(overview.companyName, company.name);
    assert.equal(overview.period, period);
    assert.equal(overview.quality.failedDownloads, 0);
    assert.equal(overview.quality.completedManagers, managerIds.length);
    assert.equal(overview.quality.fetchedProducts, overview.representativeProductCount);
    assert.equal(overview.quality.matchedScaleShareCodes / overview.quality.expectedShareCodes, overview.quality.scaleCoverage);
    if (overview.quality.expectedShareCodes >= 10) assert.ok(overview.quality.scaleCoverage >= 0.25);
    assert.deepEqual(Object.keys(overview.managers).sort(), managerIds);
    const contentHash = createHash("sha256").update(JSON.stringify(overview.managers)).digest("hex");
    assert.equal(overview.contentHash, contentHash);
    assert.equal(manifest.entries[`${company.id}:${period}`].contentHash, contentHash);
    for (const manager of Object.values(overview.managers)) {
      assert.equal(manager.period, period);
      assert.ok(Number.isFinite(manager.managedNav) && manager.managedNav >= 0);
      assert.equal(manager.requested, manager.succeeded + manager.failed);
      assert.ok(manager.holdings.length <= 10);
      assert.ok(manager.holdings.reduce((sum, item) => sum + item.weight, 0) <= 100.01);
      manager.holdings.forEach((holding, index) => {
        assert.equal(holding.rank, index + 1);
        assert.match(holding.stockCode, /^[A-Z0-9._-]{1,16}$/i);
        assert.ok(holding.stockName);
        assert.ok(Number.isFinite(holding.marketValue) && holding.marketValue >= 0);
        assert.ok(Number.isFinite(holding.weight) && holding.weight >= 0);
        assert.ok(allowedChanges.has(holding.change));
      });
    }
    assert.ok((await stat(overviewPath)).size < 1_000_000, `${company.id} mobile payload should stay below 1 MB`);
  }
  assert.equal(managerCount, snapshot.managerCount);
});
