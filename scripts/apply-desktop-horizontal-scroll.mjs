import { readFileSync, writeFileSync } from "node:fs";

const pagePath = "app/page.tsx";
let page = readFileSync(pagePath, "utf8");

const helper = `function useDesktopHorizontalScroll() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const selector = ".entity-rail,.stock-result-rail,.table-wrap,.overview-matrix-wrap,.market-industry-table-wrap";
    const cleanups = new Map<HTMLElement, () => void>();

    const bind = (node: Element) => {
      if (!(node instanceof HTMLElement) || cleanups.has(node)) return;
      const element = node;
      element.dataset.desktopHorizontalScroll = "true";
      if (!element.hasAttribute("tabindex")) element.tabIndex = 0;

      let dragging = false;
      let moved = false;
      let suppressClick = false;
      let pointerId = -1;
      let startX = 0;
      let startScrollLeft = 0;

      const canScroll = () => element.scrollWidth > element.clientWidth + 1;
      const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 0 || !canScroll()) return;
        dragging = true;
        moved = false;
        suppressClick = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startScrollLeft = element.scrollLeft;
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragging || event.pointerId !== pointerId) return;
        const distance = event.clientX - startX;
        if (!moved && Math.abs(distance) > 3) {
          moved = true;
          element.setPointerCapture?.(pointerId);
          element.classList.add("is-dragging");
        }
        if (!moved) return;
        event.preventDefault();
        element.scrollLeft = startScrollLeft - distance;
      };
      const finishDrag = (event: PointerEvent) => {
        if (!dragging || event.pointerId !== pointerId) return;
        suppressClick = moved;
        dragging = false;
        element.classList.remove("is-dragging");
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
        pointerId = -1;
      };
      const onPointerLeave = (event: PointerEvent) => {
        if (!dragging || moved || event.pointerId !== pointerId) return;
        dragging = false;
        pointerId = -1;
      };
      const onClickCapture = (event: MouseEvent) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      };
      const onWheel = (event: WheelEvent) => {
        if (!canScroll() || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return;
        const max = element.scrollWidth - element.clientWidth;
        const next = Math.max(0, Math.min(max, element.scrollLeft + event.deltaY));
        if (Math.abs(next - element.scrollLeft) < 0.5) return;
        event.preventDefault();
        element.scrollLeft = next;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (!canScroll() || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        if (event.target !== element) return;
        event.preventDefault();
        element.scrollBy({ left: event.key === "ArrowRight" ? 180 : -180, behavior: "smooth" });
      };

      element.addEventListener("pointerdown", onPointerDown);
      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerup", finishDrag);
      element.addEventListener("pointercancel", finishDrag);
      element.addEventListener("pointerleave", onPointerLeave);
      element.addEventListener("click", onClickCapture, true);
      element.addEventListener("wheel", onWheel, { passive: false });
      element.addEventListener("keydown", onKeyDown);

      cleanups.set(element, () => {
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", finishDrag);
        element.removeEventListener("pointercancel", finishDrag);
        element.removeEventListener("pointerleave", onPointerLeave);
        element.removeEventListener("click", onClickCapture, true);
        element.removeEventListener("wheel", onWheel);
        element.removeEventListener("keydown", onKeyDown);
        element.classList.remove("is-dragging");
        delete element.dataset.desktopHorizontalScroll;
      });
    };

    const scan = () => document.querySelectorAll(selector).forEach(bind);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);
}

`;

if (!page.includes("function useDesktopHorizontalScroll()")) {
  const anchor = "export default function Home() {";
  if (!page.includes(anchor)) throw new Error("Home component anchor not found");
  page = page.replace(anchor, `${helper}${anchor}`);
}

const hookCall = "  useDesktopHorizontalScroll();";
if (!page.includes(hookCall)) {
  const stateAnchor = '  const [error, setError] = useState("");';
  if (!page.includes(stateAnchor)) throw new Error("Home state anchor not found");
  page = page.replace(stateAnchor, `${stateAnchor}\n\n${hookCall}`);
}

writeFileSync(pagePath, page);

const cssPath = "app/globals.css";
let css = readFileSync(cssPath, "utf8");
const marker = "/* Desktop horizontal scrolling: wheel, visible scrollbar, and mouse drag. */";
if (!css.includes(marker)) {
  css += `

${marker}
@media (hover:hover) and (pointer:fine){
  .entity-rail,.stock-result-rail,.table-wrap,.overview-matrix-wrap,.market-industry-table-wrap{
    cursor:grab;
    overscroll-behavior-x:contain;
    scrollbar-width:thin;
    scrollbar-color:#d2a39b #f1eded;
  }
  .entity-rail::-webkit-scrollbar,.stock-result-rail::-webkit-scrollbar,.table-wrap::-webkit-scrollbar,.overview-matrix-wrap::-webkit-scrollbar,.market-industry-table-wrap::-webkit-scrollbar{
    display:block;
    height:8px;
  }
  .entity-rail::-webkit-scrollbar-thumb,.stock-result-rail::-webkit-scrollbar-thumb,.table-wrap::-webkit-scrollbar-thumb,.overview-matrix-wrap::-webkit-scrollbar-thumb,.market-industry-table-wrap::-webkit-scrollbar-thumb{
    background:#d2a39b;
    border-radius:999px;
  }
  .entity-rail::-webkit-scrollbar-track,.stock-result-rail::-webkit-scrollbar-track,.table-wrap::-webkit-scrollbar-track,.overview-matrix-wrap::-webkit-scrollbar-track,.market-industry-table-wrap::-webkit-scrollbar-track{
    background:#f1eded;
    border-radius:999px;
  }
  [data-desktop-horizontal-scroll="true"].is-dragging{
    cursor:grabbing;
    user-select:none;
    scroll-snap-type:none!important;
  }
  [data-desktop-horizontal-scroll="true"].is-dragging *{
    cursor:grabbing!important;
    user-select:none;
  }
}
`;
}
writeFileSync(cssPath, css);

console.log("Desktop horizontal scrolling enabled for rails and wide tables.");
