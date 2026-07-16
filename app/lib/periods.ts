const HOLDINGS_API = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";

export async function fetchAvailablePeriods(referenceCode = "000001") {
  const currentYear = new Date().getUTCFullYear();
  const dates = new Set<string>();
  for (const year of [currentYear, currentYear - 1]) {
    const params = new URLSearchParams({ type: "jjcc", code: referenceCode, topline: "10", year: String(year), month: "12", rt: String(Date.now()) });
    const response = await fetch(`${HOLDINGS_API}?${params}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsRadar/1.0)", referer: `https://fundf10.eastmoney.com/ccmx_${referenceCode}.html` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`period source ${response.status}`);
    const text = await response.text();
    for (const match of text.matchAll(/截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/g)) dates.add(match[1]);
  }
  return [...dates].sort().reverse().slice(0, 3);
}

