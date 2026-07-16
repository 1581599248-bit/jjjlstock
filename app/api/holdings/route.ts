import { fetchFundHoldings } from "../../lib/eastmoney";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const period = url.searchParams.get("period") ?? "";
  try {
    const data = await fetchFundHoldings(code, period);
    return Response.json(data, { headers: { "cache-control": "public, max-age=1800, s-maxage=86400" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "持仓加载失败" }, { status: 502 });
  }
}

