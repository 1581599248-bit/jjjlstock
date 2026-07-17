import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyOverviewWorkbook } from "../app/lib/export-xlsx.ts";

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
