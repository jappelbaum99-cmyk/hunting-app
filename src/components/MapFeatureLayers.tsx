import { CircleLayer, FillLayer, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import type { FeatureCollection, LineString, Point, Polygon, Position } from 'geojson';
import { useMemo, type ComponentProps } from 'react';

import { useData } from '@/data/DataProvider';
import { PROPERTY_LINE_COLOR } from '@/map/featureTypes';
import { areasToFeatures, markersToFeatures, pointsToPolygon, propertiesToFeatures } from '@/map/geo';

type OnPressEvent = Parameters<NonNullable<ComponentProps<typeof ShapeSource>['onPress']>>[0];

const LABEL_STYLE = {
  textField: ['get', 'name'],
  textSize: 12,
  textColor: '#ffffff',
  textHaloColor: '#000000',
  textHaloWidth: 1.2,
} as const;

function pressedId(event: OnPressEvent): string | null {
  const id = event.features[0]?.properties?.id;
  return typeof id === 'string' ? id : null;
}

interface Props {
  // Taps on saved features are ignored while drawing so they don't steal map taps.
  onMarkerPress?: (id: string) => void;
  onAreaPress?: (id: string) => void;
}

// Property lines, areas and markers, bottom to top.
export function SavedFeatureLayers({ onMarkerPress, onAreaPress }: Props) {
  const { markers, areas, properties } = useData();
  const markerShapes = useMemo(() => markersToFeatures(markers), [markers]);
  const areaShapes = useMemo(() => areasToFeatures(areas), [areas]);
  const propertyShapes = useMemo(() => propertiesToFeatures(properties), [properties]);

  return (
    <>
      <ShapeSource id="properties" shape={propertyShapes}>
        <LineLayer
          id="property-casing"
          style={{ lineColor: '#000000', lineWidth: 5, lineOpacity: 0.4, lineJoin: 'round' }}
        />
        <LineLayer
          id="property-line"
          style={{ lineColor: PROPERTY_LINE_COLOR, lineWidth: 2.5, lineJoin: 'round' }}
        />
      </ShapeSource>

      <ShapeSource
        id="areas"
        shape={areaShapes}
        onPress={onAreaPress && ((e) => { const id = pressedId(e); if (id) onAreaPress(id); })}
      >
        <FillLayer id="area-fill" style={{ fillColor: ['get', 'color'], fillOpacity: 0.28 }} />
        <LineLayer id="area-line" style={{ lineColor: ['get', 'color'], lineWidth: 2 }} />
        <SymbolLayer id="area-label" minZoomLevel={14} style={LABEL_STYLE} />
      </ShapeSource>

      <ShapeSource
        id="markers"
        shape={markerShapes}
        hitbox={{ width: 32, height: 32 }}
        onPress={onMarkerPress && ((e) => { const id = pressedId(e); if (id) onMarkerPress(id); })}
      >
        <CircleLayer
          id="marker-dot"
          style={{
            circleColor: ['get', 'color'],
            circleRadius: ['case', ['get', 'isStand'], 9, 7],
            circleStrokeColor: '#ffffff',
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="marker-label"
          minZoomLevel={13}
          style={{ ...LABEL_STYLE, textOffset: [0, 1.3], textAnchor: 'top' }}
        />
      </ShapeSource>
    </>
  );
}

// The shape being drawn: fill once it has 3 corners, an outline, and a dot per corner.
export function DraftShapeLayers({ points }: { points: Position[] }) {
  const shapes = useMemo(() => {
    const outline: FeatureCollection<LineString | Polygon> = { type: 'FeatureCollection', features: [] };
    if (points.length >= 3) {
      outline.features.push({ type: 'Feature', geometry: pointsToPolygon(points), properties: {} });
    } else if (points.length === 2) {
      outline.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: {} });
    }
    const vertices: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: points.map((coordinates) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} })),
    };
    return { outline, vertices };
  }, [points]);

  return (
    <>
      <ShapeSource id="draft-outline" shape={shapes.outline}>
        <FillLayer id="draft-fill" filter={['==', ['geometry-type'], 'Polygon']} style={{ fillColor: '#f28c28', fillOpacity: 0.25 }} />
        <LineLayer id="draft-line" style={{ lineColor: '#f28c28', lineWidth: 2.5, lineDasharray: [2, 1] }} />
      </ShapeSource>
      <ShapeSource id="draft-vertices" shape={shapes.vertices}>
        <CircleLayer
          id="draft-vertex"
          style={{ circleColor: '#ffffff', circleRadius: 6, circleStrokeColor: '#f28c28', circleStrokeWidth: 2.5 }}
        />
      </ShapeSource>
    </>
  );
}
