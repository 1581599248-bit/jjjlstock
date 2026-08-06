import assert from "node:assert/strict";
import test from "node:test";
import { buildStockReverseLookupWorkbook } from "../app/lib/export-stock-reverse-xlsx.ts";

test("stock reverse lookup export includes the top institution ranking sheet", () => {
  const bytes = buildStockReverseLookupWorkbook({
    period: "2026-06-30",
    source: "东方财富基金定期报告测试数据",
    detail: {
      stockCode: "301345",
      stockName: "涛涛车业",
      companyCount: 1,
      managerCount: 1,
      institutionCount: 2,
      institutions: [
        {
          rank: 1,
          companyId: "80053708",
          companyName: "汇添富基金",
          fundCount: 4,
          shares: 48.25,
          marketValue: 10860.5,
          netChangeShares: 12.5,
          changeCounts: { new: 1, increased: 2, decreased: 0, unchanged: 1, unknown: 0 },
        },
        {
          rank: 2,
          companyId: "80000222",
          companyName: "华夏基金",
          fundCount: 2,
          shares: 20.1,
          marketValue: 4520.2,
          netChangeShares: -3.2,
          changeCounts: { new: 0, increased: 0, decreased: 1, unchanged: 1, unknown: 0 },
        },
      ],
      companies: [
        { companyId: "80000222", companyName: "华夏基金", managers: [
          { managerId: "m1", managerName: "经理甲", rank: 3, navWeight: 3.07, marketValue: 480.48, change: "减持", fundCount: 1 },
        ] },
      ],
    },
  });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(content.match(/<sheet name=/g)?.length, 3);
  assert.match(content, /<sheet name="机构持仓排名"/);
  assert.match(content, /涛涛车业｜持仓该股票规模前十机构｜2026中报 · 2026-06-30/);
  assert.match(content, /汇添富基金/);
  assert.match(content, /持股数量\(万股\)/);
  assert.match(content, /持仓市值\(万元\)/);
  assert.match(content, /净增减持股数\(万股\)/);
  assert.match(content, /新进基金数/);
  assert.match(content, /增持基金数/);
  assert.match(content, /减持基金数/);
  assert.match(content, /不变基金数/);
  assert.match(content, /<c r="B3" s="3"><v>1<\/v><\/c>/);
  assert.match(content, /<c r="E3" s="3"><v>48.25<\/v><\/c>/);
  assert.match(content, /<c r="F3" s="3"><v>10860.5<\/v><\/c>/);
  assert.doesNotMatch(content, /<sheet name="股票概览"/);
});
