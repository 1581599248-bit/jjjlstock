import { readFileSync, writeFileSync } from "node:fs";

const STOCK_TAB_BASE = '<button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票配置</button>';
const STOCK_TAB_FINAL = '<button className={`stock-tab${mode === "stock" ? " active" : ""}`} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button>';
const STOCK_SCOPE_BASE = '<label><span>{mode === "industry" ? "全行业统计范围" : "股票配置范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label>';
const STOCK_SCOPE_FINAL = '<label><span>{mode === "industry" ? "全行业统计范围" : <><b className="stock-accent">股票反查</b>范围</>}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : <><b className="stock-accent">全市场</b>基金公司与基金经理</>}</div></label>';

function replaceExactlyOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`Expected one ${label} anchor, found ${count}`);
  return source.replace(oldText, newText);
}

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

if (process.argv.includes("--normalize")) {
  page = page.replace(STOCK_TAB_FINAL, STOCK_TAB_BASE);
  page = page.replace(STOCK_SCOPE_FINAL, STOCK_SCOPE_BASE);
  page = page.replace("<small>可反查股票</small>", "<small>可配置股票</small>");
  writeFileSync(pagePath, page);
  console.log("Stock reverse-lookup source normalized for the base patch.");
  process.exit(0);
}

page = replaceExactlyOnce(page, STOCK_TAB_BASE, STOCK_TAB_FINAL, "stock reverse lookup tab");
page = replaceExactlyOnce(page, STOCK_SCOPE_BASE, STOCK_SCOPE_FINAL, "stock reverse lookup scope");
page = page.replace("<small>可配置股票</small>", "<small>可反查股票</small>");
writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
const styles = `

/* Highlight the stock reverse-lookup entry and its full-market scope. */
.tabs .stock-tab{color:var(--orange)!important}
.tabs .stock-tab.active{color:var(--orange)!important}
.stock-accent{color:var(--orange);font-weight:850}
`;
if (!css.includes(".tabs .stock-tab{")) css += styles;
writeFileSync(cssPath, css);

console.log("Stock reverse-lookup label and orange accents applied.");
