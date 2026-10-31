import type { Geometry } from 'geojson';

// Hands a freshly drawn shape from the map to an editor screen without
// squeezing large geometry into route params. Reading does not clear it (React
// may run state initializers twice); the next draft simply replaces it.
let draftGeometry: Geometry | null = null;

export function setDraftGeometry(geometry: Geometry) {
  draftGeometry = geometry;
}

export function getDraftGeometry(): Geometry | null {
  return draftGeometry;
}
