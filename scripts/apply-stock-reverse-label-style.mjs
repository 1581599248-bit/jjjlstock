import { readFileSync, writeFileSync } from "node:fs";

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

const stockTabPattern = /<button className=(?:\{mode === "stock" \? "active" : ""\}|\{`stock-tab\$\{mode === "stock" \? " active" : ""\}`\}) onClick=\{\(\) => \{ setMode\("stock"\); setQuery\(""\); \}\}>(?:股票配置|股票反查)<\/button>/;
const industryTabPattern = /<button className=(?:\{mode === "industry" \? "active" : ""\}|\{`industry-tab\$\{mode === "industry" \? " active" : ""\}`\}) onClick=\{\(\) => \{ setMode\("industry"\); setQuery\(""\); \}\}>全行业<\/button>/;

const stockTab = '<button className={`stock-tab${mode === "stock" ? " active" : ""}`} onClick={() => { setMode("stock"); setQuery(""); }}>股票反查</button>';
const industryTab = '<button className={`industry-tab${mode === "industry" ? " active" : ""}`} onClick={() => { setMode("industry"); setQuery(""); }}>全行业</button>';

if (!page.includes(stockTab)) {
  if (!stockTabPattern.test(page)) throw new Error("Stock reverse-lookup tab was not found");
  page = page.replace(stockTabPattern, stockTab);
}
if (!page.includes(industryTab)) {
  if (!industryTabPattern.test(page)) throw new Error("Full-industry tab was not found");
  page = page.replace(industryTabPattern, industryTab);
}

page = page
  .replace(
    '<label><span>{mode === "industry" ? "全行业统计范围" : <><b className="stock-accent">股票反查</b>范围</>}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : <><b className="stock-accent">全市场</b>基金公司与基金经理</>}</div></label>',
    '<label><span>{mode === "industry" ? "全行业统计范围" : "股票反查范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label>',
  )
  .replace(
    '<label><span>{mode === "industry" ? "全行业统计范围" : "股票配置范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label>',
    '<label><span>{mode === "industry" ? "全行业统计范围" : "股票反查范围"}</span><div className="scope-display">{mode === "industry" ? "主动偏股公募基金 · 申万一级行业" : "全市场基金公司与基金经理"}</div></label>',
  )
  .replace("<small>可配置股票</small>", "<small>可反查股票</small>");

writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
css = css
  .replace(/\n\/\* Highlight the stock reverse-lookup entry and its full-market scope\. \*\/[\s\S]*?\.stock-accent\{color:var\(--orange\);font-weight:850\}\n?/, "\n")
  .replace(/\n\/\* Highlight only the stock reverse-lookup and full-industry tab labels\. \*\/[\s\S]*?(?=\n\/\*|$)/, "\n");

css += `

/* Keep the fourth and fifth navigation labels orange; scope text remains unchanged. */
.tabs .stock-tab,.tabs .industry-tab,.tabs>button:nth-child(4),.tabs>button:nth-child(5){color:#ff7138!important}
.tabs .stock-tab.active,.tabs .industry-tab.active,.tabs>button:nth-child(4).active,.tabs>button:nth-child(5).active{color:#ff7138!important}
`;
writeFileSync(cssPath, css);

console.log("Stock reverse-lookup and full-industry tabs are orange; scope text is restored to its original color.");
