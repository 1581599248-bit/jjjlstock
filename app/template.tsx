import type { ReactNode } from "react";
import StockExportEnhancer from "./stock-export-enhancer";

export default function Template({ children }: { children: ReactNode }) {
  return <>
    {children}
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
    `}</style>
  </>;
}
