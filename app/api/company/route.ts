import snapshot from "../../data/market-index.json";
import fundTypeSnapshot from "../../data/fund-types.json";
import { fetchCompanyFunds, fetchCompanyFundScales } from "../../lib/eastmoney";

const fundTypes = fundTypeSnapshot.types as Record<string, string>;
const fundType = (code: string) => fundTypes[code] ?? "类型待披露";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const period = new URL(request.url).searchParams.get("period") ?? "";
  const company = snapshot.companies.find((item) => item.id === id);
  if (!company) return Response.json({ error: "未找到基金公司" }, { status: 404 });
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) return Response.json({ error: "财报期无效" }, { status: 400 });
  try {
    const [funds, scales] = await Promise.all([fetchCompanyFunds(id), fetchCompanyFundScales(id, period).catch(() => new Map<string, number>())]);
    const managerByFund = new Map<string, string[]>();
    for (const manager of company.managers) for (const code of manager.fundCodes) {
      const names = managerByFund.get(code) ?? [];
      names.push(manager.name);
      managerByFund.set(code, names);
    }
    return Response.json({ company, funds: funds.map((fund) => ({ ...fund, type: fundType(fund.code), managers: managerByFund.get(fund.code) ?? [], netAsset: scales.get(fund.code) ?? null, scalePeriod: period })), mode: "live" }, { headers: { "cache-control": "public, max-age=900, s-maxage=21600" } });
  } catch {
    const scales = await fetchCompanyFundScales(id, period).catch(() => new Map<string, number>());
    const fallback = new Map<string, { code: string; name: string; type: string; pinyin: string; managers: string[]; netAsset: number | null; scalePeriod: string }>();
    for (const manager of company.managers) manager.fundCodes.forEach((code, index) => {
      const item = fallback.get(code) ?? { code, name: manager.fundNames[index] ?? code, type: fundType(code), pinyin: "", managers: [], netAsset: scales.get(code) ?? null, scalePeriod: period };
      item.managers.push(manager.name);
      fallback.set(code, item);
    });
    return Response.json({ company, funds: [...fallback.values()], mode: "snapshot" }, { headers: { "cache-control": "public, max-age=300" } });
  }
}
