import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./Masonry.css";

/* ──────────────────────────────────────────────
  Media Query Hook
────────────────────────────────────────────── */
const useMedia = (queries, values, defaultValue) => {
  const getValue = () =>
    values[queries.findIndex(q => window.matchMedia(q).matches)] ??
    defaultValue;

  const [value, setValue] = useState(getValue);

  useEffect(() => {
    const handler = () => setValue(getValue);
    queries.forEach(q =>
      window.matchMedia(q).addEventListener("change", handler)
    );
    return () =>
      queries.forEach(q =>
        window.matchMedia(q).removeEventListener("change", handler)
      );
  }, [queries]);

  return value;
};

/* ──────────────────────────────────────────────
  Measure Hook
────────────────────────────────────────────── */
const useMeasure = () => {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
};

/* ──────────────────────────────────────────────
  Image Preload
────────────────────────────────────────────── */
const preloadImages = urls =>
  Promise.all(
    urls.map(
      src =>
        new Promise(resolve => {
          const img = new Image();
          img.src = src;
          img.onload = img.onerror = resolve;
        })
    )
  );

/* ──────────────────────────────────────────────
  Masonry Component
────────────────────────────────────────────── */
export default function Masonry({ items, onItemClick, onReady }) {
  const columns = useMedia(
    ["(min-width:1400px)", "(min-width:1000px)", "(min-width:600px)"],
    [4, 3, 2],
    1
  );

  const [containerRef, { width }] = useMeasure();

  /* gap 설정 (CSS padding 12px * 2) */
  const GAP = 4;

  /* 이미지 preload 완료 시 Gallery에 알림 */
  useEffect(() => {
    preloadImages(items.map(i => i.img)).then(() => {
      onReady?.();
    });
  }, [items, onReady]);

  /* Masonry 레이아웃 계산 */
  const { grid, maxHeight } = useMemo(() => {
    if (!width) return { grid: [], maxHeight: 0 };

    const colHeights = Array(columns).fill(0);
    const colWidth = width / columns;

    const mapped = items.map(item => {
      const col = colHeights.indexOf(Math.min(...colHeights));
      const x = col * colWidth;
      const y = colHeights[col];

      // 🔥 gap 반영된 높이
      const h = item.height / 2 + GAP;
      colHeights[col] += h;

      return {
        ...item,
        x,
        y,
        w: colWidth,
        h: h - GAP
      };
    });

    return {
      grid: mapped,
      maxHeight: Math.max(...colHeights, 0)
    };
  }, [items, columns, width]);

  return (
    <div ref={containerRef} className="list" style={{ height: maxHeight }}>
      {grid.map(item => (
        <div
          key={item.id}
          className="item-wrapper"
          onClick={() => onItemClick(item)}
          style={{
            width: item.w,
            height: item.h,
            transform: `translate(${item.x}px, ${item.y}px)`
          }}
        >
          <div
            className="item-img"
            style={{ backgroundImage: `url(${item.img})` }}
          />
        </div>
      ))}
    </div>
  );
}
