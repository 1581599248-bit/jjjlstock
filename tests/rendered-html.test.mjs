import assert from "node:assert/strict";
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
  assert.match(html, /自动探测/);
  assert.match(html, /导出本页 Excel/);
  assert.match(html, /净资产规模/);
  assert.doesNotMatch(html, /当前原型来自|仅完整提供|浙商基金.*长信基金/);
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
