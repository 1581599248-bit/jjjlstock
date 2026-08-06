export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? "";
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)) {
    return Response.json({ error: "invalid period" }, { status: 400 });
  }
  try {
    const response = await fetch(new URL(`/data/market-industries/${period}.json`, request.url), { cache: "force-cache" });
    if (!response.ok) return Response.json({ error: "该财报期的主动偏股公募全行业数据尚未发布" }, { status: 404 });
    const payload = await response.json() as {
      version?: number;
      period?: string;
      scope?: { fundUniverse?: string; classification?: string };
      industries?: unknown[];
    };
    if (
      payload.version !== 2
      || payload.period !== period
      || payload.scope?.fundUniverse !== "主动偏股公募基金"
      || payload.scope?.classification !== "申万一级行业（2021）"
      || !Array.isArray(payload.industries)
    ) {
      return Response.json({ error: "全行业数据口径不匹配，请等待季度数据重新生成" }, { status: 503 });
    }
    return Response.json(payload, {
      headers: { "cache-control": "public, max-age=300, s-maxage=1800" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "全行业数据读取失败" }, { status: 503 });
  }
}
