import type { ReactNode } from "react";
import StockExportEnhancer from "./stock-export-enhancer";
import StockInstitutionRanking from "./stock-institution-ranking";

export default function Template({ children }: { children: ReactNode }) {
  return <>
    {children}
    <StockInstitutionRanking />
    <StockExportEnhancer />
    <style>{`
      .hero h1::after {
        content: "🌟光大证券上海销售团队";
        display: block;
        margin-top: 10px;
        font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        font-weight: 600;
        letter-spacing: 0;
      }
      @media (max-width: 520px) {
        .tabs button {
          font-size: 11px;
        }
      }
    `}</style>
  </>;
}
