import snapshot from "../../data/market-index.json";
import fundTypeSnapshot from "../../data/fund-types.json";
import { fetchCompanyFunds, fetchCompanyFundScaleDetails } from "../../lib/eastmoney";

const fundTypes = fundTypeSnapshot.types as Record<string, string>;
const fundType = (code: string) => fundTypes[code] ?? "类型待披露";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const period = new URL(request.url).searchParams.get("period") ?? "";
  const company = snapshot.companies.find((item) => item.id === id);
  if (!company) return Response.json({ error: "未找到基金公司" }, { status: 404 });
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "财报期无效" }, { status: 400 });
  try {
    const [funds, scaleRows] = await Promise.all([fetchCompanyFunds(id), fetchCompanyFundScaleDetails(id, period)]);
    const currentByCode = new Map(funds.map((fund) => [fund.code, fund]));
    const managerByFund = new Map<string, string[]>();
    for (const manager of company.managers) for (const code of manager.fundCodes) {
      const names = managerByFund.get(code) ?? [];
      names.push(manager.name);
      managerByFund.set(code, names);
    }
    return Response.json({ company, funds: scaleRows.map((scale) => ({ ...currentByCode.get(scale.code), ...scale, type: fundType(scale.code), pinyin: currentByCode.get(scale.code)?.pinyin ?? "", managers: managerByFund.get(scale.code) ?? [] })), mode: "live" }, { headers: { "cache-control": "public, max-age=900, s-maxage=21600" } });
  } catch {
    const scaleRows = await fetchCompanyFundScaleDetails(id, period).catch(() => []);
    const scaleByCode = new Map(scaleRows.map((row) => [row.code, row]));
    const fallback = new Map<string, { code: string; name: string; type: string; pinyin: string; managers: string[]; netAsset: number | null; endShares: number | null; scalePeriod: string }>();
    for (const manager of company.managers) manager.fundCodes.forEach((code, index) => {
      if (scaleRows.length && !scaleByCode.has(code)) return;
      const scale = scaleByCode.get(code);
      const item = fallback.get(code) ?? { code, name: scale?.name ?? manager.fundNames[index] ?? code, type: fundType(code), pinyin: "", managers: [], netAsset: scale?.netAsset ?? null, endShares: scale?.endShares ?? null, scalePeriod: period };
      item.managers.push(manager.name);
      fallback.set(code, item);
    });
    return Response.json({ company, funds: [...fallback.values()], mode: "snapshot" }, { headers: { "cache-control": "public, max-age=300" } });
  }
}
