const ENTITY_MAP = new Map([
  ["&nbsp;", " "], ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&#39;", "'"],
]);

export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITY_MAP.get(entity) ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsFromTable(tableHtml) {
  const result = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1]));
    if (cells.length < 5) continue;
    const rank = Number.parseInt(cells[0], 10);
    const industry = cells[1]?.trim() ?? "";
    const fundCount = numberValue(cells.at(-3));
    const navWeight = numberValue(cells.at(-2));
    const marketValue = numberValue(cells.at(-1));
    if (!Number.isFinite(rank) || !industry || /^(行业类别|行业名称|合计|总计)$/.test(industry)) continue;
    if (fundCount === null || navWeight === null || marketValue === null) continue;
    result.push({ rank, industry, fundCount: Math.max(0, Math.round(fundCount)), navWeight: Math.max(0, navWeight), marketValue: Math.max(0, marketValue) });
  }
  return result;
}

export function parseCompanyIndustryAllocation(html, period) {
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid report period");
  const escapedPeriod = period.replaceAll("-", "\\-");
  const blockPattern = new RegExp(`截止至[：:]?\\s*(?:<[^>]+>\\s*)*${escapedPeriod}(?:\\s*<\\/[^>]+>)*[\\s\\S]{0,2000}?<table\\b[^>]*>([\\s\\S]*?)<\\/table>`, "gi");
  for (const match of html.matchAll(blockPattern)) {
    const rows = rowsFromTable(match[1]);
    if (rows.length) return rows;
  }

  const periodIndex = html.indexOf(period);
  if (periodIndex >= 0) {
    const tail = html.slice(periodIndex, periodIndex + 80_000);
    const table = tail.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
    if (table) {
      const rows = rowsFromTable(table[1]);
      if (rows.length) return rows;
    }
  }

  return [];
}
