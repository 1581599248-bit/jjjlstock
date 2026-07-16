import type { FundHoldings, FundItem, Holding, ManagerIndex, MarketIndex } from "../types";

const MANAGER_API = "https://fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx";
const FUND_LIST_API = "https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx";
const HOLDINGS_API = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";
const QUOTE_API = "https://push2.eastmoney.com/api/qt/stock/get";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)", referer: "https://fund.eastmoney.com/" };

function unescapeHtml(value: string) {
  return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

async function fetchText(url: string, referer = HEADERS.referer) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { headers: { ...HEADERS, referer }, signal: controller.signal });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error("empty upstream response");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally { clearTimeout(timeout); }
  }
  throw lastError instanceof Error ? lastError : new Error("upstream request failed");
}

function extractJsonArray(text: string, startToken = "data:") {
  const tokenIndex = text.indexOf(startToken);
  if (tokenIndex < 0) throw new Error(`missing ${startToken}`);
  const start = text.indexOf("[", tokenIndex + startToken.length);
  if (start < 0) throw new Error("missing array start");
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") { depth -= 1; if (depth === 0) return JSON.parse(text.slice(start, index + 1)) as string[][]; }
  }
  throw new Error("unterminated array");
}

export function parseManagerRows(text: string): ManagerIndex[] {
  return extractJsonArray(text).map((row) => ({
    id: row[0] ?? "", name: row[1] ?? "", companyId: row[2] ?? "", companyName: row[3] ?? "",
    fundCodes: (row[4] ?? "").split(",").filter(Boolean), fundNames: (row[5] ?? "").split(",").filter(Boolean),
    tenureDays: Number.parseInt(row[6] ?? "0", 10) || 0,
    bestReturn: Number.isFinite(Number.parseFloat(row[7])) ? Number.parseFloat(row[7]) : null,
    bestFundCode: row[8] ?? "", bestFundName: row[9] ?? "",
  })).filter((item) => item.id && item.name && item.companyId);
}

export function buildMarketIndex(managers: ManagerIndex[], generatedAt = new Date().toISOString()): MarketIndex {
  const grouped = new Map<string, { name: string; managers: ManagerIndex[] }>();
  for (const manager of managers) { const entry = grouped.get(manager.companyId) ?? { name: manager.companyName, managers: [] }; entry.managers.push(manager); grouped.set(manager.companyId, entry); }
  const companies = [...grouped.entries()].map(([id, entry]) => {
    const codes = new Set(entry.managers.flatMap((manager) => manager.fundCodes));
    return { id, name: entry.name, managerCount: entry.managers.length, managedFundCount: codes.size, managers: entry.managers.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return { generatedAt, source: "东方财富基金公开数据", sourceUrl: MANAGER_API, companyCount: companies.length, managerCount: managers.length, managedFundCount: new Set(managers.flatMap((manager) => manager.fundCodes)).size, companies };
}

export async function fetchMarketIndex() {
  const makeUrl = (page: number) => `${MANAGER_API}?${new URLSearchParams({ dt: "14", mc: "returnjson", ft: "all", pn: "50", pi: String(page), sc: "abbname", st: "asc" })}`;
  const firstText = await fetchText(makeUrl(1));
  const pages = Number.parseInt(firstText.match(/pages:(\d+)/)?.[1] ?? "1", 10);
  const texts = [firstText];
  for (let page = 2; page <= pages; page += 8) texts.push(...await Promise.all(Array.from({ length: Math.min(8, pages - page + 1) }, (_, offset) => fetchText(makeUrl(page + offset)))));
  return buildMarketIndex(texts.flatMap(parseManagerRows));
}

export function parseFundRows(text: string): FundItem[] {
  return extractJsonArray(text, "datas:").map((row) => ({ code: row[0] ?? "", name: row[1] ?? "", pinyin: row[2] ?? "", type: "公募基金", managers: [] })).filter((item) => /^\d{6}$/.test(item.code));
}

export async function fetchCompanyFunds(companyId: string) {
  const params = new URLSearchParams({ t: "1", lx: "1", letter: "", gsid: companyId, text: "", sort: "zdf,desc", page: "1,2000", dt: String(Date.now()) });
  return parseFundRows(await fetchText(`${FUND_LIST_API}?${params}`));
}

function stripTags(value: string) { return unescapeHtml(value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()); }

function parseQuarterTables(text: string) {
  const result = new Map<string, Omit<Holding, "change" | "changeShares">[]>();
  const blockPattern = /截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/g;
  for (const match of text.matchAll(blockPattern)) {
    const rows: Omit<Holding, "change" | "changeShares">[] = [];
    for (const rowMatch of match[2].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => stripTags(cell[1]));
      if (cells.length < 6) continue;
      const weightCell = cells.at(-3) ?? "";
      const sharesCell = cells.at(-2) ?? "";
      const marketValueCell = cells.at(-1) ?? "";
      rows.push({ rank: Number.parseInt(cells[0], 10) || rows.length + 1, stockCode: cells[1], stockName: cells[2], weight: Number.parseFloat(weightCell.replace("%", "")) || 0, shares: Number.parseFloat(sharesCell.replace(/,/g, "")) || 0, marketValue: Number.parseFloat(marketValueCell.replace(/,/g, "")) || 0 });
    }
    result.set(match[1], rows.slice(0, 10));
  }
  return result;
}

function priorPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (month === 3) return `${year - 1}-12-31`;
  if (month === 6) return `${year}-03-31`;
  if (month === 9) return `${year}-06-30`;
  return `${year}-09-30`;
}

function changeLabel(current: number, previous: number | undefined): Pick<Holding, "change" | "changeShares"> {
  if (previous === undefined) return { change: "新进", changeShares: current };
  const delta = current - previous;
  if (Math.abs(delta) < 0.005) return { change: "不变", changeShares: 0 };
  return { change: delta > 0 ? "增持" : "减持", changeShares: delta };
}

export async function fetchFundHoldings(code: string, period: string): Promise<FundHoldings> {
  if (!/^\d{6}$/.test(code) || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("invalid holdings query");
  const years = new Set([period.slice(0, 4), priorPeriod(period).slice(0, 4)]);
  const maps = await Promise.all([...years].map(async (year) => {
    const params = new URLSearchParams({ type: "jjcc", code, topline: "10", year, month: period.slice(5, 7), rt: String(Date.now()) });
    return parseQuarterTables(await fetchText(`${HOLDINGS_API}?${params}`, `https://fundf10.eastmoney.com/ccmx_${code}.html`));
  }));
  const quarters = new Map<string, Omit<Holding, "change" | "changeShares">[]>();
  for (const map of maps) for (const [date, rows] of map) quarters.set(date, rows);
  const previous = new Map((quarters.get(priorPeriod(period)) ?? []).map((row) => [row.stockCode, row.shares]));
  const holdings = (quarters.get(period) ?? []).map((row) => ({ ...row, ...changeLabel(row.shares, previous.get(row.stockCode)) }));
  return { code, period, source: "东方财富基金公开数据", fetchedAt: new Date().toISOString(), holdings };
}

export async function fetchFundNetAsset(code: string, period: string) {
  if (!/^\d{6}$/.test(code) || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("invalid net asset query");
  const params = new URLSearchParams({ type: "gmbd", code, rt: String(Date.now()) });
  const text = await fetchText(`${HOLDINGS_API}?${params}`, `https://fundf10.eastmoney.com/gmbd_${code}.html`);
  for (const rowMatch of text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => stripTags(cell[1]));
    if (cells[0] !== period || cells.length < 5) continue;
    const netAssetYi = Number.parseFloat(cells[4].replace(/,/g, ""));
    return Number.isFinite(netAssetYi) ? netAssetYi * 10_000 : null;
  }
  return null;
}

function securityId(code: string) {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 5) return `116.${digits}`;
  return `${/^[569]/.test(digits) ? "1" : "0"}.${digits}`;
}

export async function fetchStockIndustry(code: string) {
  const params = new URLSearchParams({ secid: securityId(code), fields: "f57,f58,f127" });
  const text = await fetchText(`${QUOTE_API}?${params}`, "https://quote.eastmoney.com/");
  const payload = JSON.parse(text) as { data?: { f127?: string } | null };
  return payload.data?.f127?.trim() || "其他/未分类";
}
