const SCALE_API = "https://fund.eastmoney.com/Company1/GMBD/QMore";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; FundHoldingsScaleSync/1.0)", referer: "https://fund.eastmoney.com/" };

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function scaleNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCompanyScaleRows(payload, period) {
  const unique = new Map();
  for (const row of payload.Datas ?? []) {
    if (row.FSRQ && String(row.FSRQ) !== period) continue;
    const code = String(row.BZDM ?? "");
    if (!/^\d{6}$/.test(code)) continue;
    unique.set(code, {
      code,
      name: String(row.SHORTNAME ?? code).trim() || code,
      period,
      netAsset: scaleNumber(row.QMJZC),
      endShares: scaleNumber(row.QMZFE),
    });
  }
  return [...unique.values()];
}

export async function fetchCompanyScaleRows(companyId, period, options = {}) {
  if (!/^\d{8}$/.test(companyId) || !/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) throw new Error("Invalid company scale query");
  const attempts = Math.max(1, Math.min(8, Number(options.attempts ?? 5)));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeout ?? 20_000));
    try {
      const cacheBust = `${Date.now()}-${companyId}-${attempt}-${Math.random().toString(36).slice(2)}`;
      const params = new URLSearchParams({
        id: companyId,
        curyear: period.slice(0, 4),
        pagesize: "10",
        Q: String(Number(period.slice(5, 7)) / 3),
        fundtype: "0",
        JZRQ: period,
        ftype: "全部",
        rt: cacheBust,
        cb: cacheBust,
      });
      const response = await fetch(`${SCALE_API}?${params}`, {
        headers: { ...HEADERS, referer: `https://fund.eastmoney.com/Company1/f10/gmbd_${companyId}.html` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Scale upstream ${response.status}`);
      const rows = parseCompanyScaleRows(await response.json(), period);
      if (!rows.length) throw new Error("Empty company scale response");
      const expectedCodes = options.expectedCodes ? new Set(options.expectedCodes) : null;
      if (expectedCodes?.size) {
        const matched = rows.filter((row) => expectedCodes.has(row.code)).length;
        const minimumMatched = Math.min(expectedCodes.size, Math.max(1, Math.ceil(expectedCodes.size * 0.25)));
        if (matched < minimumMatched) throw new Error(`Mismatched company scale response (${matched}/${expectedCodes.size})`);
      }
      return rows;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Company scale request failed");
}

export function productScaleFields(product, scaleByCode) {
  const rows = product.shareCodes.map((code) => scaleByCode.get(code)).filter(Boolean);
  const netAssets = rows.map((row) => row.netAsset).filter((value) => value !== null);
  const endShares = rows.map((row) => row.endShares).filter((value) => value !== null);
  return {
    netAsset: netAssets.length ? netAssets.reduce((sum, value) => sum + value, 0) : null,
    endShares: endShares.length ? endShares.reduce((sum, value) => sum + value, 0) : null,
    scalePeriod: rows[0]?.period ?? "",
  };
}
