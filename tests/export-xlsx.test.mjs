import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyFundsWorkbook, buildCompanyInstitutionWorkbook, buildCompanyManagerSectorsWorkbook, buildCompanyOverviewWorkbook } from "../app/lib/export-xlsx.ts";
import { buildStockReverseLookupWorkbook } from "../app/lib/export-stock-reverse-xlsx.ts";

test("company overview export contains every manager, left-aligns fund counts, and separates every rank", () => {
  const managers = Array.from({ length: 25 }, (_, index) => ({
    name: `经理${index + 1}`,
    tenureYears: index + 0.5,
    fundCount: index + 1,
    managedNav: (index + 1) * 10_000,
    holdings: [{ stockName: `股票${index + 1}`, weight: index + 0.25, change: "增持" }],
  }));
  const bytes = buildCompanyOverviewWorkbook({ companyName: "测试基金", period: "2026-03-31", managers });
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const content = new TextDecoder().decode(bytes);
  assert.match(content, /经理25/);
  assert.match(content, /当前基金公司旗下全部 25 位基金经理/);
  assert.match(content, /<c r="B5" s="5"><v>1<\/v><\/c>/);
  assert.match(content, /<alignment horizontal="left" vertical="center"\/>/);
  assert.match(content, /<row r="6" ht="8" customHeight="1"\/><row r="7"><c r="A7" s="0" t="inlineStr"><is><t xml:space="preserve">第1名<\/t><\/is><\/c>/);
  assert.match(content, /<row r="10" ht="8" customHeight="1"\/><row r="11"><c r="A11" s="0" t="inlineStr"><is><t xml:space="preserve">第2名<\/t><\/is><\/c>/);
  assert.match(content, /<row r="46" ht="8" customHeight="1"\/>/);
  assert.equal(content.match(/ht="8" customHeight="1"\/>/g)?.length, 11);
});

test("company fund export follows the reference row-wise product layout", () => {
  const funds = Array.from({ length: 25 }, (_, index) => ({
    code: String(index + 1),
    name: `基金产品${index + 1}`,
    type: "混合型",
    managers: [`经理${index + 1}`],
    netAsset: index + 0.25,
    endShares: index + 0.5,
    holdings: [{ rank: 1, stockCode: "600000", stockName: `股票${index + 1}`, weight: index + 0.5, shares: 10, marketValue: 100, change: "增持", changeShares: 1 }],
  }));
  const bytes = buildCompanyFundsWorkbook({ companyName: "测试基金", period: "2026-03-31", funds, source: "测试数据源" });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(content, /基金产品25/);
  assert.match(content, /<c r="B3" s="5" t="inlineStr"><is><t xml:space="preserve">000001<\/t><\/is><\/c>/);
  assert.match(content, /<c r="C3" s="8"><v>0.25<\/v><\/c>/);
  assert.match(content, /<numFmt numFmtId="164" formatCode="0.00##"\/>/);
  assert.match(content, /<c r="D3" s="5" t="inlineStr"><is><t xml:space="preserve">经理1<\/t><\/is><\/c>/);
  assert.match(content, /<c r="E3" s="5" t="inlineStr"><is><t xml:space="preserve">混合型<\/t><\/is><\/c>/);
  assert.match(content, /<c r="G3" s="5" t="inlineStr"><is><t xml:space="preserve">股票1<\/t><\/is><\/c>/);
  assert.match(content, /<c r="H3" s="9"><v>0.005<\/v><\/c>/);
  assert.match(content, /<c r="I3" s="5" t="inlineStr"><is><t xml:space="preserve">增持<\/t><\/is><\/c>/);
  assert.match(content, /<mergeCell ref="A1:AJ1"\/>/);
  assert.match(content, /<autoFilter ref="A2:AJ27"\/>/);
  assert.doesNotMatch(content, /报告期末份额\(亿份\)/);
  assert.match(content, /当前基金公司在报告期内的全部 25 只基金产品/);
  assert.doesNotMatch(content, /ht="8" customHeight="1"\/>/);
});

test("company manager-sector export contains every manager, left-aligns every cell, formats percentages, and puts other last", () => {
  const managers = Array.from({ length: 25 }, (_, index) => ({
    name: `经理${index + 1}`,
    tenureYears: index + 0.5,
    fundCount: index + 1,
    managedNav: (index + 1) * 10_000,
    sectors: [
      { rank: 1, industry: "其他/未分类", marketValue: 40, navWeight: 4, holdingShare: 40, stockCount: 1 },
      { rank: 2, industry: "电子", marketValue: 60, navWeight: 6, holdingShare: 60, stockCount: 2 },
    ],
  }));
  const bytes = buildCompanyManagerSectorsWorkbook({ companyName: "测试基金", period: "2026-03-31", managers, source: "东方财富行业字段" });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(content, /经理25/);
  assert.match(content, /<c r="A1" s="6" t="inlineStr">/);
  assert.match(content, /<c r="B2" s="7" t="inlineStr">/);
  assert.match(content, /<row r="6" ht="8" customHeight="1"\/><row r="7"><c r="A7" s="5" t="inlineStr"><is><t xml:space="preserve">第1行业<\/t><\/is><\/c>/);
  assert.match(content, /<c r="B7" s="5" t="inlineStr"><is><t xml:space="preserve">电子<\/t><\/is><\/c>/);
  assert.match(content, /<c r="B8" s="9"><v>0.06<\/v><\/c>/);
  assert.match(content, /<c r="B9" s="9"><v>0.6<\/v><\/c>/);
  assert.match(content, /<c r="B11" s="5" t="inlineStr"><is><t xml:space="preserve">其他\/未分类<\/t><\/is><\/c>/);
  assert.doesNotMatch(content, /行业持仓市值\(万元\)/);
  assert.doesNotMatch(content, /涉及股票数/);
  assert.doesNotMatch(content, /<c r="[A-Z]+\d+" s="[0-4]"/);
  assert.match(content, /当前基金公司旗下全部 25 位基金经理/);
  assert.equal(content.match(/ht="8" customHeight="1"\/>/g)?.length, 11);
});

test("institution export combines overview, manager industries, and products into exactly three sheets", () => {
  const managers = Array.from({ length: 3 }, (_, index) => ({
    name: `经理${index + 1}`,
    tenureYears: index + 1.5,
    fundCount: index + 1,
    managedNav: (index + 1) * 10_000,
    holdings: [{ stockName: `股票${index + 1}`, weight: index + 0.5, change: "增持" }],
    sectors: [{ rank: 1, industry: "电子", marketValue: 100, navWeight: 5, holdingShare: 50, stockCount: 2 }],
  }));
  const funds = [{
    code: "000001",
    name: "测试产品",
    type: "混合型",
    managers: ["经理1"],
    netAsset: 1.25,
    endShares: 1.1,
    holdings: [{ rank: 1, stockCode: "600000", stockName: "浦发银行", weight: 3.5, shares: 10, marketValue: 100, change: "增持", changeShares: 1 }],
  }];
  const bytes = buildCompanyInstitutionWorkbook({ companyName: "测试基金", period: "2026-03-31", source: "测试数据源", managers, funds });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(content, /<sheet name="基金总览"/);
  assert.match(content, /<sheet name="基金经理行业"/);
  assert.match(content, /<sheet name="基金产品"/);
  assert.equal(content.match(/<sheet name=/g)?.length, 3);
  assert.match(content, /经理3/);
  assert.match(content, /电子/);
  assert.match(content, /测试产品/);
  assert.match(content, /浦发银行/);
  assert.doesNotMatch(content, /<sheet name="数据口径"/);
});

test("stock reverse lookup export keeps institution order and sorts managers by market value within each institution", () => {
  const bytes = buildStockReverseLookupWorkbook({
    period: "2026-06-30",
    source: "测试股票反查数据源",
    detail: {
      stockCode: "600000",
      stockName: "浦发银行",
      companyCount: 2,
      managerCount: 3,
      companies: [
        { companyId: "1", companyName: "甲基金", managers: [
          { managerId: "m1", managerName: "经理甲", rank: 1, navWeight: 12.34, marketValue: 567.8, change: "增持", fundCount: 2 },
          { managerId: "m2", managerName: "经理乙", rank: 3, navWeight: 5.67, marketValue: 1234.5, change: "不变", fundCount: 1 },
        ] },
        { companyId: "2", companyName: "乙基金", managers: [
          { managerId: "m3", managerName: "经理丙", rank: 2, navWeight: 8.9, marketValue: 890.1, change: "减持", fundCount: 3 },
        ] },
      ],
    },
  });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(content.match(/<sheet name=/g)?.length, 2);
  assert.doesNotMatch(content, /<sheet name="股票概览"/);
  assert.match(content, /<sheet name="机构经理明细"/);
  assert.match(content, /浦发银行｜持仓机构与基金经理｜2026中报 · 2026-06-30/);
  assert.match(content, /经理重仓名次/);
  assert.doesNotMatch(content, /持仓规模排名/);
  const managerYi = content.indexOf("经理乙");
  const managerJia = content.indexOf("经理甲");
  const managerBing = content.indexOf("经理丙");
  assert.ok(managerYi >= 0 && managerJia > managerYi && managerBing > managerJia);
  assert.match(content, /<c r="G3" s="4"><v>0.0567<\/v><\/c>/);
  assert.match(content, /测试股票反查数据源/);
});
