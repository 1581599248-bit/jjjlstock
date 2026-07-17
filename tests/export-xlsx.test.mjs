import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyFundsWorkbook, buildCompanyManagerSectorsWorkbook, buildCompanyOverviewWorkbook } from "../app/lib/export-xlsx.ts";

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
  assert.match(content, /<row r="9" ht="8" customHeight="1"\/><row r="10"><c r="A10" s="0" t="inlineStr"><is><t xml:space="preserve">第2名<\/t><\/is><\/c>/);
  assert.match(content, /<row r="45" ht="8" customHeight="1"\/>/);
  assert.equal(content.match(/ht="8" customHeight="1"\/>/g)?.length, 10);
});

test("company fund export contains every product, preserves leading-zero codes, and separates ranks", () => {
  const funds = Array.from({ length: 25 }, (_, index) => ({
    code: String(index + 1).padStart(6, "0"),
    name: `基金产品${index + 1}`,
    managers: [`经理${index + 1}`],
    netAsset: index + 0.25,
    holdings: [{ rank: 1, stockCode: "600000", stockName: `股票${index + 1}`, weight: index + 0.5, shares: 10, marketValue: 100, change: "增持", changeShares: 1 }],
  }));
  const bytes = buildCompanyFundsWorkbook({ companyName: "测试基金", period: "2026-03-31", funds, source: "测试数据源" });
  const content = new TextDecoder().decode(bytes);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(content, /基金产品25/);
  assert.match(content, /<c r="B3" s="5" t="inlineStr"><is><t xml:space="preserve">000001<\/t><\/is><\/c>/);
  assert.match(content, /当前基金公司旗下全部 25 只基金产品/);
  assert.match(content, /<row r="9" ht="8" customHeight="1"\/><row r="10"><c r="A10" s="0" t="inlineStr"><is><t xml:space="preserve">第2名<\/t><\/is><\/c>/);
  assert.equal(content.match(/ht="8" customHeight="1"\/>/g)?.length, 10);
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
  assert.match(content, /<c r="B6" s="5" t="inlineStr"><is><t xml:space="preserve">电子<\/t><\/is><\/c>/);
  assert.match(content, /<c r="B7" s="9"><v>0.06<\/v><\/c>/);
  assert.match(content, /<c r="B8" s="9"><v>0.6<\/v><\/c>/);
  assert.match(content, /<c r="B12" s="5" t="inlineStr"><is><t xml:space="preserve">其他\/未分类<\/t><\/is><\/c>/);
  assert.doesNotMatch(content, /<c r="[A-Z]+\d+" s="[0-4]"/);
  assert.match(content, /当前基金公司旗下全部 25 位基金经理/);
  assert.equal(content.match(/ht="8" customHeight="1"\/>/g)?.length, 10);
});
