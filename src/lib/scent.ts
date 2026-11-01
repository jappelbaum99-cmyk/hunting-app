// Scent cones: the wedge of ground downwind of a stand where a deer could
// smell you. Rough rules of thumb, not a physics model:
// - steady wind carries scent further and keeps it in a tighter wedge;
// - light wind (under 3 mph) lets scent pool and swirl, so the wedge is short and wide;
// - gusty wind spreads it wider.
import type { Polygon } from 'geojson';

import type { ForecastHour } from '@/lib/weather';

const METERS_PER_DEG_LAT = 111_320;
const ARC_STEPS = 12;

export interface ConeShape {
  lengthM: number;
  halfAngleDeg: number;
}

export function coneShape(hour: ForecastHour): ConeShape {
  if (hour.windMph < 3) return { lengthM: 150, halfAngleDeg: 45 };
  const lengthM = Math.min(600, 250 + hour.windMph * 25);
  const gusty = hour.gustMph > hour.windMph * 1.6 && hour.gustMph > 12;
  return { lengthM, halfAngleDeg: gusty ? 22 : 15 };
}

// Point `distanceM` meters from [lng, lat] toward `bearingDeg` (0 = north).
// A flat-earth step is accurate enough over a few hundred meters.
function offset([lng, lat]: [number, number], bearingDeg: number, distanceM: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(rad)) / METERS_PER_DEG_LAT;
  const dLng = (distanceM * Math.sin(rad)) / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [lng + dLng, lat + dLat];
}

export function scentCone(lng: number, lat: number, hour: ForecastHour): Polygon {
  const { lengthM, halfAngleDeg } = coneShape(hour);
  // Wind direction is where it comes FROM; scent goes the other way.
  const downwind = hour.windFromDeg + 180;
  const origin: [number, number] = [lng, lat];
  const arc: [number, number][] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const bearing = downwind - halfAngleDeg + (2 * halfAngleDeg * i) / ARC_STEPS;
    arc.push(offset(origin, bearing, lengthM));
  }
  return { type: 'Polygon', coordinates: [[origin, ...arc, origin]] };
}
