import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { SW_LEVEL_ONE, findSinaSwNodes, loadSinaSwClassification, validateSwClassification } from "../scripts/lib/sw-classification.mjs";

test("SW catalog parser finds only the explicitly labelled first-level tree", () => {
  const nodes = [["电子", "", "sw1_270000"]];
  assert.equal(findSinaSwNodes(["行情中心", [["A股", [["申万一级", nodes]]]]]), nodes);
  assert.equal(findSinaSwNodes(["申万二级", nodes]), null);
});

test("backup classification fails closed on incomplete pages and conflicting stocks", async () => {
  const nodes = SW_LEVEL_ONE.map((item, i) => [item.name, "", `sw1_${String(i).padStart(6, "0")}`]);
  const request = async (method) => method === "getHQNodes" ? ["申万一级", nodes]
    : method === "getHQNodeStockCount" ? "100" : [];
  await assert.rejects(loadSinaSwClassification(SW_LEVEL_ONE, { request, concurrency: 1 }), /Incomplete SW page/);
  const conflicting = async (method) => method === "getHQNodes" ? ["申万一级", nodes]
    : method === "getHQNodeStockCount" ? "1" : [{ code: "600000", symbol: "sh600000" }];
  await assert.rejects(loadSinaSwClassification(SW_LEVEL_ONE, { request: conflicting, concurrency: 1 }), /Conflicting SW classification/);
});

test("published Q3 industry totals, counts and quarter changes reconcile to all fund snapshots", async () => {
  const base = new URL("../", import.meta.url);
  const read = async (file) => JSON.parse(await readFile(new URL(file, base), "utf8"));
  const cache = await read("public/data/market-industries/sw-industry-cache.json");
  assert.ok(validateSwClassification(cache));
  const malformed = structuredClone(cache);
  malformed.stockIndustries[Object.keys(malformed.stockIndustries)[0]].industryCode = "000000";
  assert.equal(validateSwClassification(malformed), false);
  const current = await read("public/data/market-industries/2026-09-30.json");
  const prior = await read("public/data/market-industries/2026-06-30.json");
  const market = await read("public/data/market/2026-09-30.json");
  const fundsDir = "public/data/funds/2026-09-30/";
  const files = (await readdir(new URL(fundsDir, base))).filter((name) => /^\d{8}\.json$/.test(name));
  assert.deepEqual(new Set(files.map((name) => name.slice(0, -5))), new Set(market.companies.map((item) => item.id)));
  const allowed = new Set(["股票型", "股票型-普通股票", "混合型-偏股", "混合型-灵活", "混合型-平衡"]);
  const sums = new Map(SW_LEVEL_ONE.map((i) => [i.code, { value: 0, funds: new Set() }]));
  const allFunds = new Set();
  const shares = new Set();
  let total = 0;
  for (const name of files) {
    const payload = await read(fundsDir + name);
    assert.equal(payload.period, current.period);
    for (const product of payload.products) {
      if (!allowed.has(product.type)) continue;
      assert.ok(!allFunds.has(product.code), `Duplicate product ${product.code}`);
      allFunds.add(product.code);
      for (const share of product.shareCodes ?? [product.code]) {
        assert.ok(!shares.has(share), `Share counted in multiple products: ${share}`);
        shares.add(share);
      }
      for (const h of product.holdings ?? []) {
        if (!/^[034689]\d{5}$/.test(h.stockCode) || !(h.marketValue > 0)) continue;
        total += h.marketValue;
        const industry = cache.stockIndustries[h.stockCode];
        if (!industry) continue;
        const aggregate = sums.get(industry.industryCode);
        aggregate.value += h.marketValue;
        aggregate.funds.add(product.code);
      }
    }
  }
  const classified = [...sums.values()].reduce((a, b) => a + b.value, 0);
  const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-10), `${a} != ${b}`);
  assert.equal(current.industryCount, 31);
  assert.equal(current.activeFundCount, allFunds.size);
  assert.equal(current.priorPeriod, prior.period);
  close(current.aShareMarketValue, total);
  close(current.classifiedMarketValue, classified);
  close(current.classificationCoverage, classified / total);
  assert.ok(current.classificationCoverage > 0.99);
  close(current.industries.reduce((a, b) => a + b.allocationShare, 0), 100);
  for (const [index, row] of current.industries.entries()) {
    const aggregate = sums.get(row.industryCode);
    close(row.marketValue, aggregate.value);
    close(row.allocationShare, aggregate.value / classified * 100);
    close(row.qoqChange, row.allocationShare - prior.industries.find((i) => i.industryCode === row.industryCode).allocationShare);
    assert.equal(row.fundCount, aggregate.funds.size);
    assert.equal(row.rank, index + 1);
    if (index) assert.ok(current.industries[index - 1].marketValue >= row.marketValue);
  }
  const periods = await read("app/data/published-periods.json");
  assert.ok(!periods.pendingIndustryPeriods.includes(current.period));
});
