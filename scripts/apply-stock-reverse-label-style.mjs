import { readFileSync, writeFileSync } from "node:fs";

function replaceExactlyOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`Expected one ${label} anchor, found ${count}`);
  return source.replace(oldText, newText);
}

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

page = replaceExactlyOnce(
  page,
  '<button className={mode === "stock" ? "active" : ""} onClick={() => { setMode("stock"); setQuery(""); }}>股票配置</button>',
  '<button className={`stock-tab${mode === "stock" ? " active" : ""}`} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button>',
  "stock reverse lookup tab",
);

page = replaceExactlyOnce(
  page,
  '<label><span>{mode === "industry" ? "全行业统计范围" : "股票配置范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label>',
  '<label><span>{mode === "industry" ? "全行业统计范围" : <><b className="stock-accent">股票反查</b>范围</>}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : <><b className="stock-accent">全市场</b>基金公司与基金经理</>}</div></label>',
  "stock reverse lookup scope",
);

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
