import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

interface ImagePointPickerProps {
  src: string;
  width: number;
  height: number;
  points: [number, number][];
  // Index of the point waiting for its map match, drawn highlighted.
  activeIndex: number | null;
  onPick(point: [number, number]): void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
// A press that moves less than this is a click, not a pan.
const CLICK_SLOP_PX = 4;

// Shows an image you can zoom (mouse wheel) and pan (drag), and reports
// clicks in image pixel coordinates.
export function ImagePointPicker({ src, width, height, points, activeIndex, onPick }: ImagePointPickerProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null>(null);

  // Fit the whole image when it changes.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / width, el.clientHeight / height);
    setView({ scale, x: (el.clientWidth - width * scale) / 2, y: (el.clientHeight - height * scale) / 2 });
  }, [src, width, height]);

  const onWheel = (event: WheelEvent) => {
    const rect = viewport.current!.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-event.deltaY * 0.0015)));
      // Keep the pixel under the cursor in place.
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false };
  };

  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    d.moved = true;
    setView((v) => ({ ...v, x: d.viewX + dx, y: d.viewY + dy }));
  };

  const onPointerUp = (event: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const rect = viewport.current!.getBoundingClientRect();
    const x = (event.clientX - rect.left - view.x) / view.scale;
    const y = (event.clientY - rect.top - view.y) / view.scale;
    if (x >= 0 && y >= 0 && x <= width && y <= height) onPick([x, y]);
  };

  return (
    <div
      ref={viewport}
      className="image-picker"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="image-picker-stage"
        style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <img src={src} width={width} height={height} alt="" draggable={false} />
        {points.map(([x, y], i) => (
          <span
            key={i}
            className={`control-point${i === activeIndex ? ' active' : ''}`}
            // Counter-scale so the dot stays the same size at any zoom.
            style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="image-picker-hint">Scroll to zoom · drag to move</div>
    </div>
  );
}
