// Map names are HTML markers, which the map doesn't keep apart the way it does
// its own text. This hides any name that would land on a more important one,
// or on a pin, so names never pile up on each other. Hidden names keep their
// space (visibility, not display), so they can be measured again on the next pass.

const COLLIDED = 'label-collided';
// Breathing room around each name, in pixels.
const PAD = 2;

// Most important first: whatever is selected, then property names, pins,
// hunt spots, areas, sections and trails.
const PRIORITY = [
  '.map-pin-selected .map-pin-label, .map-label-selected, .hunt-spot-selected .hunt-spot-label',
  '.map-label-property',
  '.map-pin-label',
  '.hunt-spot-label',
  '.map-label-area',
  '.map-label-section',
  '.map-label-trail',
];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const boxOf = (el: Element, pad: number): Box | null => {
  const r = el.getBoundingClientRect();
  // Names turned off in Map labels are display: none and measure as nothing.
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
};

export function declutterLabels(container: HTMLElement): void {
  const view = container.getBoundingClientRect();
  // Pin dots always show, so names make way for them.
  const placed: Box[] = [];
  for (const dot of container.querySelectorAll('.map-pin-dot')) {
    const box = boxOf(dot, 0);
    if (box) placed.push(box);
  }
  const done = new Set<Element>();
  for (const selector of PRIORITY) {
    for (const el of container.querySelectorAll(selector)) {
      if (done.has(el)) continue;
      done.add(el);
      const box = boxOf(el, PAD);
      if (!box) {
        el.classList.remove(COLLIDED);
        continue;
      }
      // Off screen: nothing to collide with that anyone can see.
      const onScreen = box.right > view.left && box.left < view.right && box.bottom > view.top && box.top < view.bottom;
      const selected = selector === PRIORITY[0];
      const hit = onScreen && !selected && placed.some((p) => overlaps(p, box));
      el.classList.toggle(COLLIDED, hit);
      if (!hit && onScreen) placed.push(box);
    }
  }
}
