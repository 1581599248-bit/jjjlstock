type Cell = string | number | null;

export type StockReverseExportManager = {
  managerId: string;
  managerName: string;
  rank: number;
  navWeight: number;
  marketValue: number;
  change: string;
  fundCount: number;
};

export type StockReverseExportCompany = {
  companyId: string;
  companyName: string;
  managers: StockReverseExportManager[];
};

export type StockReverseExportDetail = {
  stockCode: string;
  stockName: string;
  companyCount: number;
  managerCount: number;
  companies: StockReverseExportCompany[];
};

export type StockReverseLookupExportInput = {
  period: string;
  source: string;
  detail: StockReverseExportDetail;
};

const encoder = new TextEncoder();
const xml = (value: Cell) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (index: number) => {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

function sheet(title: string, headers: string[], rows: Cell[][], widths: number[], numeric: number[] = [], percent: number[] = []) {
  const all = [[title], headers, ...rows];
  const max = Math.max(headers.length, ...rows.map((row) => row.length));
  const body = all.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ""}>${row.map((value, columnIndex) => {
    const ref = `${col(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? 1 : rowIndex === 1 ? 2 : percent.includes(columnIndex) ? 4 : numeric.includes(columnIndex) ? 3 : 0;
    return typeof value === "number"
      ? `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`
      : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData><autoFilter ref="A2:${col(max - 1)}${all.length}"/><mergeCells count="1"><mergeCell ref="A1:${col(max - 1)}1"/></mergeCells></worksheet>`;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (value: number) => new Uint8Array([value & 255, value >>> 8 & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]);
function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zip(files: Record<string, string>) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
    locals.push(local);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    offset += local.length;
  }
  const directory = concat(central);
  return concat([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(directory.length), u32(offset), u16(0)]);
}

function workbook(sheetEntries: Array<{ name: string; xml: string }>) {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map((entry, index) => `<sheet name="${xml(entry.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="16"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF63332E"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB85C45"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFE7D8CF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheetEntries.forEach((entry, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = entry.xml; });
  return zip(files);
}

function download(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function periodDisplay(period: string) {
  const year = period.slice(0, 4);
  const month = period.slice(5, 7);
  const report = month === "03" ? "一季报" : month === "06" ? "中报" : month === "09" ? "三季报" : "年报";
  return `${year}${report} · ${period}`;
}

export function buildStockReverseLookupWorkbook(input: StockReverseLookupExportInput) {
  const detailRows: Cell[][] = input.detail.companies.flatMap((company) => [...company.managers]
    .sort((a, b) => b.marketValue - a.marketValue
      || b.navWeight - a.navWeight
      || a.managerName.localeCompare(b.managerName, "zh-CN"))
    .map((manager) => [
      input.period,
      input.detail.stockCode,
      input.detail.stockName,
      company.companyName,
      manager.managerName,
      manager.rank,
      manager.navWeight / 100,
      manager.marketValue,
      manager.fundCount,
      manager.change,
    ]));
  const notesRows: Cell[][] = [
    ["数据源", input.source],
    ["反查口径", "基金经理在管产品合并后的前十大重仓；未进入经理前十不代表完全未持有。"],
    ["联合管理", "联合管理基金分别计入对应基金经理。"],
    ["经理内重仓排名", "该股票在对应基金经理合并后前十大重仓中的名次，不是跨经理持仓规模排名。"],
    ["净值占比", "该股票披露持仓市值占基金经理同口径管理净资产的比例。"],
    ["机构统计", "机构数量和经理数量表示覆盖范围，不将经理持仓市值再次汇总为机构市值。"],
    ["排序规则", "按基金公司分组；同一机构内按该股票披露持仓市值从高到低排列，不跨机构混排。"],
    ["用途", "公募基金季度持仓研究，不构成投资建议。"],
  ];
  return workbook([
    { name: "机构经理明细", xml: sheet(`${input.detail.stockName}｜持仓机构与基金经理｜${periodDisplay(input.period)}`, ["财报期", "股票代码", "股票名称", "基金公司", "基金经理", "经理内重仓排名", "净值占比", "披露市值(万元)", "涉及基金数", "持仓变化"], detailRows, [14, 13, 18, 24, 18, 16, 14, 18, 14, 13], [5, 7, 8], [6]) },
    { name: "数据口径", xml: sheet("数据源与口径", ["类别", "说明"], notesRows, [24, 100]) },
  ]);
}

export function exportStockReverseLookupWorkbook(input: StockReverseLookupExportInput) {
  const safeName = input.detail.stockName.replace(/[\\/:*?"<>|]/g, "_");
  download(buildStockReverseLookupWorkbook(input), `${safeName}_${input.detail.stockCode}_${input.period}_股票反查.xlsx`);
}
