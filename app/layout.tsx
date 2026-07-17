import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "持仓雷达｜公募基金季度重仓透视", description: "按财报期、基金公司、基金经理和基金产品查看前十大重仓股，并导出高密度 Excel。" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#211c1d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
