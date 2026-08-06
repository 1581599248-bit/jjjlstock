import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCompanyIndustryAllocation } from "../scripts/lib/market-industry-parser.mjs";

test("parses a company industry allocation table for an exact report period", () => {
  const html = `
    <h3>测试基金 2026年2季度股票投资明细(全部)</h3>
    <p>截止至：<font>2026-06-30</font></p>
    <table><thead><tr><th>序号</th><th>行业类别</th><th>相关链接</th><th>本公司持有基金数</th><th>占净值比例</th><th>市值（万元）</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>制造业</td><td>详情</td><td>82</td><td>18.48%</td><td>632,096.13</td></tr>
      <tr><td>2</td><td>金融业</td><td>详情</td><td>28</td><td>4.50%</td><td>153,948.24</td></tr>
    </tbody></table>`;
  assert.deepEqual(parseCompanyIndustryAllocation(html, "2026-06-30"), [
    { rank: 1, industry: "制造业", fundCount: 82, navWeight: 18.48, marketValue: 632096.13 },
    { rank: 2, industry: "金融业", fundCount: 28, navWeight: 4.5, marketValue: 153948.24 },
  ]);
  assert.deepEqual(parseCompanyIndustryAllocation(html, "2026-03-31"), []);
});

test("market industry module is mounted as a dedicated full-market tab", async () => {
  const [component, patch, builder] = await Promise.all([
    readFile(new URL("../app/market-industry-allocation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/apply-fund-product-search-patch.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-static-market-industries.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(component, /全市场行业配置/);
  assert.match(component, /占公募净值/);
  assert.match(component, /股票仓位占比/);
  assert.match(component, /\/data\/market-industries\/\$\{period\}\.json/);
  assert.match(patch, /行业配置/);
  assert.match(patch, /MarketIndustryAllocation/);
  assert.match(builder, /Company\/f10\/hypz_/);
  assert.match(builder, /coveredCompanyCount/);
});
