import snapshot from "../../data/market-index.json";
import { fetchCompanyFunds } from "../../lib/eastmoney";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const company = snapshot.companies.find((item) => item.id === id);
  if (!company) return Response.json({ error: "未找到基金公司" }, { status: 404 });
  try {
    const funds = await fetchCompanyFunds(id);
    const managerByFund = new Map<string, string[]>();
    for (const manager of company.managers) for (const code of manager.fundCodes) {
      const names = managerByFund.get(code) ?? [];
      names.push(manager.name);
      managerByFund.set(code, names);
    }
    return Response.json({ company, funds: funds.map((fund) => ({ ...fund, managers: managerByFund.get(fund.code) ?? [] })), mode: "live" }, { headers: { "cache-control": "public, max-age=900, s-maxage=21600" } });
  } catch {
    const fallback = new Map<string, { code: string; name: string; type: string; pinyin: string; managers: string[] }>();
    for (const manager of company.managers) manager.fundCodes.forEach((code, index) => {
      const item = fallback.get(code) ?? { code, name: manager.fundNames[index] ?? code, type: "公募基金", pinyin: "", managers: [] };
      item.managers.push(manager.name);
      fallback.set(code, item);
    });
    return Response.json({ company, funds: [...fallback.values()], mode: "snapshot" }, { headers: { "cache-control": "public, max-age=300" } });
  }
}

