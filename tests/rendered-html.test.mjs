import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const url = new URL(`../dist/server/index.js?test=${process.pid}-${Date.now()}`, import.meta.url);
  return (await import(url.href)).default;
}
const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the mobile-first full-market holdings dashboard", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /全市场持仓雷达/);
  assert.match(html, /全市场基金与基金经理/);
  assert.match(html, /基金经理/);
  assert.match(html, /基金产品/);
  assert.match(html, /基金总览/);
  assert.match(html, /当前已发布财报期/);
  assert.match(html, /导出全部经理 Excel/);
  assert.match(html, /报告期基金总规模/);
  assert.match(html, /在管基金产品/);
  assert.match(html, /A\/C 等份额已去重/);
  assert.match(html, /预计算静态数据/);
  assert.doesNotMatch(html, /在管基金代码/);
  assert.doesNotMatch(html, /当前原型来自|仅完整提供|浙商基金.*长信基金/);
});

test("offers the all-fund-products export action", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /导出全部基金 Excel/);
  assert.match(pageSource, /\/data\/funds\/\$\{period\}\/\$\{companyId\}\.json/);
});

test("offers the all-manager industry export action", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /导出全部行业 Excel/);
  assert.match(pageSource, /\/data\/sectors\/\$\{period\}\/\$\{companyId\}\.json/);
  assert.match(pageSource, /setManagerHoldings\(\{ \.\.\.precomputed, sectors: orderSectors\(staticManager\?\.sectors \?\? \[\]\) \}\)/);
  assert.match(pageSource, /切换经理无需再次逐只基金查询/);
});

test("ships a complete full-market fallback index", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/api/market"), env, ctx);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.companyCount >= 150);
  assert.ok(data.managerCount >= 4000);
  assert.ok(data.managedFundCount >= 20000);
  assert.ok(data.companies.some((item) => item.name === "华夏基金"));
});
