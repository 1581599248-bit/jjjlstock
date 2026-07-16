import type { Holding } from "../types";

type Cell = string | number | null;
type ExportInput = {
  companyName: string;
  entityType: "基金" | "基金经理";
  entityName: string;
  entityCode?: string;
  period: string;
  holdings: Array<Holding | { rank: number; stockCode: string; stockName: string; marketValue: number; fundCount: number }>;
  notes: Array<[string, Cell]>;
};

const encoder = new TextEncoder();
const xml = (value: Cell) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (index: number) => { let value = index + 1; let result = ""; while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; };

function sheet(title: string, headers: string[], rows: Cell[][], widths: number[], numeric: number[] = []) {
  const all = [[title], headers, ...rows];
  const max = Math.max(headers.length, ...rows.map((row) => row.length));
  const body = all.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ""}>${row.map((value, columnIndex) => {
    const ref = `${col(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? 1 : rowIndex === 1 ? 2 : numeric.includes(columnIndex) ? 3 : 0;
    return typeof value === "number" ? `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData><autoFilter ref="A2:${col(max - 1)}${all.length}"/><mergeCells count="1"><mergeCell ref="A1:${col(max - 1)}1"/></mergeCells></worksheet>`;
}

function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
const u16 = (value: number) => new Uint8Array([value & 255, value >>> 8 & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]);
function concat(parts: Uint8Array[]) { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function zip(files: Record<string, string>) {
  const locals: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name); const data = encoder.encode(content); const checksum = crc32(data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
    locals.push(local); central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes])); offset += local.length;
  }
  const directory = concat(central); return concat([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(directory.length), u32(offset), u16(0)]);
}

export function exportHoldingsWorkbook(input: ExportInput) {
  const isFund = input.entityType === "基金";
  const rows: Cell[][] = input.holdings.map((row) => {
    if ("weight" in row) return [input.period, row.rank, row.stockCode, row.stockName, row.weight / 100, row.shares, row.marketValue, row.change, row.changeShares];
    return [input.period, row.rank, row.stockCode, row.stockName, null, null, row.marketValue, `${row.fundCount} 只基金`, null];
  });
  const overview: Cell[][] = [["基金公司", input.companyName], [input.entityType, input.entityName], ["代码", input.entityCode ?? "—"], ["财报期", input.period], ["导出时间", new Date().toLocaleString("zh-CN")], ...input.notes];
  const sheets = [
    sheet(`${input.companyName}｜${input.entityName}｜${input.period}`, ["项目", "值"], overview, [24, 74]),
    sheet(`${input.entityName}｜前十大重仓股`, ["财报期", "排名", "股票代码", "股票名称", "占净值", "持股数(万股)", "持仓市值(万元)", "持仓变化", "变动股数(万股)"], rows, [14, 8, 13, 18, 12, 16, 18, 13, 18], [4, 5, 6, 8]),
    sheet("数据源与口径", ["类别", "说明"], [["主数据源", "iFind 官方 API（配置后优先）"], ["自动容灾", "东方财富基金公开数据"], ["基金经理口径", "对在管基金的前十大重仓股按披露持仓市值汇总；同一产品多份额在研究时应去重。"], ["更新机制", "网站自动探测最新可用财报期，接口结果按季度缓存。"], ["用途", "客户基金经理季度持仓研究，不构成投资建议。"]], [24, 90]),
  ];
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="概览" sheetId="1" r:id="rId1"/><sheet name="十大重仓" sheetId="2" r:id="rId2"/><sheet name="数据口径" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="16"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A3D34"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17675A"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFDDE5E0"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((value, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = value; });
  const bytes = zip(files); const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${input.companyName}_${input.entityName}_${input.period}_重仓股.xlsx`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

