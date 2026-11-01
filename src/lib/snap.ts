// Snapping while drawing: a click near an existing line lands exactly on it,
// so sections and areas share the property line instead of almost touching it.
// Distances are measured on screen, so snapping feels the same at any zoom.
import type { Position } from 'geojson';

import type { AreaGeometry } from '@/types/models';

export interface Snap {
  position: [number, number];
  // A corner of the line, or somewhere along it.
  kind: 'vertex' | 'edge';
}

type Project = (lngLat: [number, number]) => { x: number; y: number };

// Every ring (outline) of the shapes, as lng/lat points.
export function ringsOf(geometries: AreaGeometry[]): Position[][] {
  return geometries.flatMap((g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()));
}

// Corners win over edges when both are in reach: hitting an exact corner is
// almost always what's wanted.
export function findSnap(
  cursor: { x: number; y: number },
  rings: Position[][],
  tolerancePx: number,
  project: Project,
): Snap | null {
  if (tolerancePx <= 0) return null;
  let bestVertex: { d: number; p: [number, number] } | null = null;
  let bestEdge: { d: number; p: [number, number] } | null = null;

  for (const ring of rings) {
    const screen = ring.map((p) => project([p[0], p[1]]));
    for (let i = 0; i < ring.length; i++) {
      const a = screen[i];
      const d = Math.hypot(a.x - cursor.x, a.y - cursor.y);
      if (d <= tolerancePx && (!bestVertex || d < bestVertex.d)) bestVertex = { d, p: [ring[i][0], ring[i][1]] };

      if (i === ring.length - 1) continue;
      const b = screen[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      // Closest point on segment a-b to the cursor, as a fraction along it.
      const t = Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / len2));
      const ed = Math.hypot(a.x + t * dx - cursor.x, a.y + t * dy - cursor.y);
      if (ed <= tolerancePx && (!bestEdge || ed < bestEdge.d)) {
        // Interpolating lng/lat is accurate enough over one property edge.
        const [p, q] = [ring[i], ring[i + 1]];
        bestEdge = { d: ed, p: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] };
      }
    }
  }

  if (bestVertex) return { position: bestVertex.p, kind: 'vertex' };
  if (bestEdge) return { position: bestEdge.p, kind: 'edge' };
  return null;
}
