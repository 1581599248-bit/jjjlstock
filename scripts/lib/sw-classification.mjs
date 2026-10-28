export const SW_LEVEL_ONE = [
  ["801010", "农林牧渔"], ["801030", "基础化工"], ["801040", "钢铁"], ["801050", "有色金属"],
  ["801080", "电子"], ["801110", "家用电器"], ["801120", "食品饮料"], ["801130", "纺织服饰"],
  ["801140", "轻工制造"], ["801150", "医药生物"], ["801160", "公用事业"], ["801170", "交通运输"],
  ["801180", "房地产"], ["801200", "商贸零售"], ["801210", "社会服务"], ["801230", "综合"],
  ["801710", "建筑材料"], ["801720", "建筑装饰"], ["801730", "电力设备"], ["801740", "国防军工"],
  ["801750", "计算机"], ["801760", "传媒"], ["801770", "通信"], ["801780", "银行"],
  ["801790", "非银金融"], ["801880", "汽车"], ["801890", "机械设备"], ["801950", "煤炭"],
  ["801960", "石油石化"], ["801970", "环保"], ["801980", "美容护理"],
].map(([code, name]) => ({code, name}));

const SINA_API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.";
export const SINA_SOURCE = "https://vip.stock.finance.sina.com.cn/mkt/#sw1_hy";

export function validateSwClassification(value) {
  if (value?.version !== 1 || value.industries?.length !== 31 || !value.stockIndustries) return false;
  const codes = new Set(value.industries.map((item) => item.code));
  const names = new Set(value.industries.map((item) => item.name));
  const expected = new Map(SW_LEVEL_ONE.map((item) => [item.code, item.name]));
  const stocks = Object.entries(value.stockIndustries);
  return codes.size === 31 && names.size === 31 && stocks.length >= 4000
    && value.industries.every((item) => expected.get(item.code) === item.name)
    && stocks.every(([code, item]) => /^\d{6}$/.test(code) && expected.get(item.industryCode) === item.industry);
}

export function findSinaSwNodes(tree) {
  if (!Array.isArray(tree)) return null;
  if (tree[0] === "申万一级" && Array.isArray(tree[1])) return tree[1];
  for (const child of tree) {
    const nodes = findSinaSwNodes(child);
    if (nodes) return nodes;
  }
  return null;
}

export async function loadSinaSwClassification(industries, { concurrency = 6, request = requestJson } = {}) {
  const nodes = findSinaSwNodes(await request("getHQNodes", {}));
  if (nodes?.length !== 31 || industries.length !== 31) throw new Error("Sina SW2021 catalog must contain 31 industries");
  const byName = new Map(industries.map((item) => [item.name, item]));
  const mapping = {};
  const counts = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, async () => {
    while (cursor < nodes.length) {
      const [name, , node] = nodes[cursor++];
      const industry = byName.get(name);
      if (!industry || !/^sw1_\d{6}$/.test(node)) throw new Error(`Unexpected SW node ${name}: ${node}`);
      const expected = Number(await request("getHQNodeStockCount", { node }));
      if (!(expected > 0) || !Number.isInteger(expected)) throw new Error(`Invalid stock count for ${node}`);
      const seen = new Set();
      for (let page = 1; page <= Math.ceil(expected / 80); page += 1) {
        const rows = await request("getHQNodeData", { node, page: String(page), num: "80", sort: "symbol", asc: "1" });
        if (!Array.isArray(rows) || rows.length !== Math.min(80, expected - (page - 1) * 80)) throw new Error(`Incomplete SW page ${node}/${page}`);
        for (const row of rows) {
          const code = String(row.code ?? "");
          if (!/^\d{6}$/.test(code) || !/^(sh|sz|bj)\d{6}$/.test(row.symbol ?? "") || seen.has(code)) throw new Error(`Invalid or duplicate SW stock ${node}/${code}`);
          if (mapping[code] && mapping[code].industry !== name) throw new Error(`Conflicting SW classification for ${code}`);
          seen.add(code);
          mapping[code] = { industry: name, industryCode: industry.code };
        }
      }
      if (seen.size !== expected) throw new Error(`SW count mismatch for ${node}: ${seen.size}/${expected}`);
      counts.push({ industry: name, node, stockCount: seen.size });
      console.log(JSON.stringify({ status: "sw-backup-industry", industry: name, stocks: seen.size }));
    }
  }));
  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "新浪财经申万2021一级行业分类",
    sourceUrls: [SINA_SOURCE],
    classificationTiming: "抓取时点的申万2021分类，与原实时成分股接口口径一致；非历史时点分类",
    industries,
    stockIndustries: mapping,
    quality: { industryCounts: counts.sort((a, b) => a.node.localeCompare(b.node)) },
  };
  if (!validateSwClassification(result)) throw new Error("Incomplete backup SW classification");
  return result;
}

async function requestJson(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${SINA_API}${method}?${new URLSearchParams(params)}`, {
        headers: { referer: "https://vip.stock.finance.sina.com.cn/", "user-agent": "Mozilla/5.0", accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`Sina HTTP ${response.status}`);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw lastError;
}
