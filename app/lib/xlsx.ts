type Holding = { rank: number; stock: string; weight: number; change: string; changeShares: number | null };
type Fund = { name: string; size: number; managers: string[]; return1y: number; type: string; concentration: number; holdings: Holding[]; concepts: { name: string; weight: number }[] };
type Manager = { name: string; size: number; tenure: number; fundCount: number; equityFundCount: number; concentration: number; aggregation: string; managedFundNames: string[]; holdings: Holding[] };
type Company = { name: string; reportPeriod: string; source: string; stats: { fundCount: number; managerCount: number; totalSize: number; equityFundCount: number }; funds: Fund[]; managers: Manager[] };
type Cell = string | number | null;

const encoder = new TextEncoder();
const xml = (value: Cell) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
}

function worksheetXml(title: string, headers: string[], rows: Cell[][], widths: number[], percentColumns: number[] = []) {
  const allRows: Cell[][] = [[title], headers, ...rows];
  const maxCol = Math.max(headers.length, ...rows.map((row) => row.length));
  const cellXml = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? 1 : rowIndex === 1 ? 2 : percentColumns.includes(colIndex) ? 4 : typeof value === "number" ? 3 : 0;
      return typeof value === "number"
        ? `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`
        : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ''}>${cells}</row>`;
  }).join("");
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const filterEnd = `${columnName(maxCol - 1)}${allRows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${cellXml}</sheetData><autoFilter ref="A2:${filterEnd}"/><mergeCells count="1"><mergeCell ref="A1:${columnName(maxCol - 1)}1"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concat(parts: Uint8Array[]) { const total = parts.reduce((sum, part) => sum + part.length, 0); const result = new Uint8Array(total); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }

function zipStore(files: Record<string, string>) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name); const data = encoder.encode(content); const checksum = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
    locals.push(local);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    offset += local.length;
  }
  const centralData = concat(central);
  return concat([...locals, centralData, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralData.length), u32(offset), u16(0)]);
}

export async function exportCompanyWorkbook(company: Company, methodology: string) {
  const summaryRows: Cell[][] = [
    ["财报期", company.reportPeriod], ["基金公司", company.name], ["数据源", company.source], ["基金数量", company.stats.fundCount], ["基金经理数量", company.stats.managerCount], ["样本基金规模（亿元）", company.stats.totalSize], ["有股票持仓基金数", company.stats.equityFundCount], ["经理汇总口径", methodology], ["导出时间", new Date().toLocaleString("zh-CN")],
  ];
  const fundRows = company.funds.flatMap((fund) => fund.holdings.length ? fund.holdings.map((holding) => [company.reportPeriod, fund.name, fund.type, fund.size, fund.return1y / 100, fund.managers.join("、"), holding.rank, holding.stock, holding.weight / 100, holding.change, holding.changeShares, fund.concentration / 100, fund.concepts.map((item) => `${item.name} ${item.weight.toFixed(1)}%`).join("；")]) : [[company.reportPeriod, fund.name, fund.type, fund.size, fund.return1y / 100, fund.managers.join("、"), null, "未披露股票持仓", null, "未披露", null, 0, ""]]);
  const managerRows = company.managers.flatMap((manager) => manager.holdings.length ? manager.holdings.map((holding) => [company.reportPeriod, manager.name, manager.size, manager.tenure, manager.fundCount, manager.equityFundCount, holding.rank, holding.stock, holding.weight / 100, holding.change, holding.changeShares, manager.concentration / 100, manager.aggregation, manager.managedFundNames.join("、")]) : [[company.reportPeriod, manager.name, manager.size, manager.tenure, manager.fundCount, manager.equityFundCount, null, "未披露股票持仓", null, "未披露", null, 0, manager.aggregation, manager.managedFundNames.join("、")]]);
  const sourceRows: Cell[][] = [["主数据源", "同花顺 iFind 导出文件", "季度基金持仓、基金规模、基金经理、收益率、概念暴露"], ["备选数据源", "Tushare Pro", "fund_portfolio / fund_manager，需有效 Token 与相应积分权限"], ["公开校验", "基金定期报告 / 东方财富公开页面", "用于抽样核验，不作为稳定生产 API"], ["经理口径", methodology, "多经理基金会计入每一位现任经理；结果用于客户研究，不等同于经理本人账户持仓"], ["历史期", "当前文件仅完整提供 2026Q1 基金明细", "2025Q4 与 2025Q3 预留为后续同模板导入"]];
  const sheets = [
    worksheetXml(`${company.name}｜${company.reportPeriod} 持仓概览`, ["指标", "数值"], summaryRows, [24, 70]),
    worksheetXml(`${company.name}｜基金产品前十大重仓`, ["财报期", "基金名称", "类型", "规模(亿元)", "近1年收益", "基金经理", "排名", "股票名称", "占净值", "变化", "变动股数", "前十集中度", "概念暴露"], fundRows, [12, 32, 12, 14, 14, 22, 9, 18, 12, 12, 16, 14, 42], [4, 8, 11]),
    worksheetXml(`${company.name}｜基金经理前十大重仓`, ["财报期", "基金经理", "在管规模(亿元)", "年限", "在管基金数", "有股票持仓基金数", "排名", "股票名称", "估算权重", "变化", "变动股数", "前十集中度", "汇总口径", "在管产品"], managerRows, [12, 14, 16, 10, 14, 18, 9, 18, 12, 12, 16, 14, 26, 50], [8, 11]),
    worksheetXml(`${company.name}｜数据源与口径`, ["类别", "来源/定义", "说明"], sourceRows, [18, 54, 72]),
  ];
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="概览" sheetId="1" r:id="rId1"/><sheet name="基金十大重仓" sheetId="2" r:id="rId2"/><sheet name="经理十大重仓" sheetId="3" r:id="rId3"/><sheet name="数据口径" sheetId="4" r:id="rId4"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F2D2A"/></font><font><b/><sz val="16"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3B35"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14594E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFDDE5E0"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = sheet; });
  const bytes = zipStore(files);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${company.name}_${company.reportPeriod}_重仓股分析.xlsx`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
