export type ManagerIndex = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  fundCodes: string[];
  fundNames: string[];
  tenureDays: number;
  bestReturn: number | null;
  bestFundCode: string;
  bestFundName: string;
};

export type CompanyIndex = {
  id: string;
  name: string;
  managerCount: number;
  managedFundCount: number;
  managers: ManagerIndex[];
};

export type MarketIndex = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  companyCount: number;
  managerCount: number;
  managedFundCount: number;
  companies: CompanyIndex[];
};

export type FundItem = {
  code: string;
  name: string;
  type: string;
  pinyin: string;
  managers: string[];
};

export type Holding = {
  rank: number;
  stockCode: string;
  stockName: string;
  weight: number;
  shares: number;
  marketValue: number;
  change: "新进" | "增持" | "减持" | "不变" | "未知";
  changeShares: number | null;
};

export type FundHoldings = {
  code: string;
  period: string;
  source: string;
  fetchedAt: string;
  holdings: Holding[];
};

