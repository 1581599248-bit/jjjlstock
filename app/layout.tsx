import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "持仓雷达｜公募基金季度重仓透视";
const description = "按财报期和基金公司查看公司总览、全部基金经理与基金产品前十大重仓股，并导出高密度 Excel。";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "fund-holdings-radar.ryan0815.chatgpt.site";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return { title, description, openGraph: { title, description, type: "website", images: [{ url: image, width: 1536, height: 1024, alt: "全市场持仓雷达" }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#211c1d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
