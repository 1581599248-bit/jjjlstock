import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("full-industry module uses the active equity and SW level-one scope", async () => {
  const [component, patch, builder, route] = await Promise.all([
    readFile(new URL("../app/market-industry-allocation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/apply-fund-product-search-patch.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-static-market-industries.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market-industries/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(component, /<h2>全行业<\/h2>/);
  assert.match(component, /普通股票型 \+ 偏股混合型 \+ 灵活配置型 \+ 平衡混合型/);
  assert.match(component, /申万一级行业/);
  assert.match(component, /<th>排名<\/th><th>行业<\/th><th className="num">总市值<\/th>/);
  assert.match(component, /\{quarterLabel\(period\)\}占比/);
  assert.match(component, /环比变动/);
  assert.doesNotMatch(component, /占公募净值/);
  assert.doesNotMatch(component, /股票仓位占比/);

  const stockTab = patch.indexOf(">股票配置</button>");
  const industryTab = patch.indexOf(">全行业</button>");
  assert.ok(stockTab >= 0 && industryTab > stockTab, "全行业 must be placed after 股票配置");
  assert.match(patch, /MarketIndustryAllocation/);

  for (const fundType of ["股票型", "混合型-偏股", "混合型-灵活", "混合型-平衡"]) assert.match(builder, new RegExp(fundType));
  assert.match(builder, /indextype: "一级行业"/);
  assert.match(builder, /component_stocks/);
  assert.match(builder, /allocationShare/);
  assert.match(builder, /qoqChange/);
  assert.match(builder, /申万一级行业（2021）/);

  assert.match(route, /version !== 2/);
  assert.match(route, /主动偏股公募基金/);
  assert.match(route, /申万一级行业（2021）/);
  assert.doesNotMatch(route, /buildLive/);
});

test("quarterly pipeline publishes the full-industry snapshot", async () => {
  const [marketBuilder, refreshWorkflow] = await Promise.all([
    readFile(new URL("../scripts/build-static-market.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quarterly-refresh.yml", import.meta.url), "utf8"),
  ]);
  assert.match(marketBuilder, /build-static-market-industries\.mjs/);
  assert.match(refreshWorkflow, /public\/data\/market-industries/);
});
