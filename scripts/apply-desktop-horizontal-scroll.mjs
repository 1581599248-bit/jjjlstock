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

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "desktop-horizontal-slider";
      slider.min = "0";
      slider.step = "1";
      slider.value = "0";
      slider.setAttribute("aria-label", "横向滑动");
      element.insertAdjacentElement("afterend", slider);

      let dragging = false;
      let moved = false;
      let suppressClick = false;
      let pointerId = -1;
      let startX = 0;
      let startScrollLeft = 0;
      let syncing = false;

      const canScroll = () => element.scrollWidth > element.clientWidth + 1;
      const syncSlider = () => {
        const max = Math.max(0, element.scrollWidth - element.clientWidth);
        slider.max = String(max);
        slider.hidden = max <= 1;
        if (!syncing) slider.value = String(Math.min(max, Math.max(0, element.scrollLeft)));
      };
      const onElementScroll = () => {
        syncing = true;
        slider.value = String(element.scrollLeft);
        syncing = false;
      };
      const onSliderInput = () => {
        syncing = true;
        element.scrollLeft = Number(slider.value);
        syncing = false;
      };
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
      element.addEventListener("scroll", onElementScroll, { passive: true });
      slider.addEventListener("input", onSliderInput);

      const resizeObserver = new ResizeObserver(syncSlider);
      resizeObserver.observe(element);
      if (element.firstElementChild) resizeObserver.observe(element.firstElementChild);
      syncSlider();

      cleanups.set(element, () => {
        resizeObserver.disconnect();
        element.removeEventListener("pointerdown", onPointerDown);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", finishDrag);
        element.removeEventListener("pointercancel", finishDrag);
        element.removeEventListener("pointerleave", onPointerLeave);
        element.removeEventListener("click", onClickCapture, true);
        element.removeEventListener("wheel", onWheel);
        element.removeEventListener("keydown", onKeyDown);
        element.removeEventListener("scroll", onElementScroll);
        slider.removeEventListener("input", onSliderInput);
        slider.remove();
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

const helperStart = page.indexOf("function useDesktopHorizontalScroll() {");
const homeAnchor = "export default function Home() {";
const homeIndex = page.indexOf(homeAnchor);
if (helperStart >= 0 && homeIndex > helperStart) {
  page = page.slice(0, helperStart) + helper + page.slice(homeIndex);
} else if (homeIndex >= 0) {
  page = page.slice(0, homeIndex) + helper + page.slice(homeIndex);
} else {
  throw new Error("Home component anchor not found");
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
const marker = "/* Desktop horizontal scrolling: wheel, visible scrollbar, mouse drag, and dedicated slider. */";
const oldMarker = "/* Desktop horizontal scrolling: wheel, visible scrollbar, and mouse drag. */";
const nextMarker = "/* Keep the fourth and fifth navigation labels orange; scope text remains unchanged. */";
const cssBlock = `${marker}
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
  .desktop-horizontal-slider{
    display:block;
    width:100%;
    height:18px;
    margin:5px 0 10px;
    padding:0;
    cursor:ew-resize;
    accent-color:var(--orange);
  }
  .desktop-horizontal-slider[hidden]{display:none}
  .desktop-horizontal-slider::-webkit-slider-runnable-track{
    height:7px;
    background:#eee8e7;
    border:1px solid #e4d6d2;
    border-radius:999px;
  }
  .desktop-horizontal-slider::-webkit-slider-thumb{
    width:30px;
    height:15px;
    margin-top:-5px;
    appearance:none;
    -webkit-appearance:none;
    background:linear-gradient(135deg,var(--red),var(--orange));
    border:2px solid #fff;
    border-radius:999px;
    box-shadow:0 2px 6px rgba(185,40,32,.24);
  }
  .desktop-horizontal-slider::-moz-range-track{
    height:7px;
    background:#eee8e7;
    border:1px solid #e4d6d2;
    border-radius:999px;
  }
  .desktop-horizontal-slider::-moz-range-thumb{
    width:28px;
    height:13px;
    background:linear-gradient(135deg,var(--red),var(--orange));
    border:2px solid #fff;
    border-radius:999px;
    box-shadow:0 2px 6px rgba(185,40,32,.24);
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

const markerIndex = Math.max(css.indexOf(marker), css.indexOf(oldMarker));
if (markerIndex >= 0) {
  const nextIndex = css.indexOf(nextMarker, markerIndex);
  css = nextIndex >= 0 ? css.slice(0, markerIndex) + cssBlock + "\n\n" + css.slice(nextIndex) : css.slice(0, markerIndex) + cssBlock;
} else {
  css += `\n\n${cssBlock}`;
}
writeFileSync(cssPath, css);

console.log("Desktop horizontal scrolling enabled with a dedicated slider below every wide rail and table.");
