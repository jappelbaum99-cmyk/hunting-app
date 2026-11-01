import { useRef, type MouseEvent } from 'react';

import { IMAGE_ACCEPT } from '@/data/images';
import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import { IMPORT_ACCEPT } from '@/lib/importGeo';
import type { AreaType, MarkerType } from '@/types/models';

interface MapToolbarProps {
  disabled: boolean;
  onDrawProperty(): void;
  onDrawSection(): void;
  onDrawArea(type: AreaType): void;
  onPlaceMarker(type: MarkerType): void;
  onImport(file: File): void;
  onAddImage(file: File): void;
}

export function MapToolbar(props: MapToolbarProps) {
  const { disabled, onDrawProperty, onDrawSection, onDrawArea, onPlaceMarker, onImport, onAddImage } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  // Closes the <details> dropdown after picking an option.
  const pick = (event: MouseEvent, action: () => void) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    action();
  };

  return (
    <div className="map-toolbar">
      {/* Everything for getting a property line onto the map. */}
      <details className="dropdown">
        <summary className={disabled ? 'disabled' : ''}>Property ▾</summary>
        <div className="dropdown-menu wide">
          <button onClick={(e) => pick(e, onDrawProperty)}>
            <span className="menu-text">
              <span>Draw property</span>
              <span className="menu-hint">Click each corner of the property line</span>
            </span>
          </button>
          <button onClick={(e) => pick(e, () => fileInput.current?.click())}>
            <span className="menu-text">
              <span>Import KML/GPX</span>
              <span className="menu-hint">Boundaries and waypoints from Google Earth, onX, a survey…</span>
            </span>
          </button>
          <button onClick={(e) => pick(e, () => imageInput.current?.click())}>
            <span className="menu-text">
              <span>Add map image</span>
              <span className="menu-hint">Line up a parcel map screenshot, then trace it</span>
            </span>
          </button>
        </div>
      </details>

      <button
        disabled={disabled}
        onClick={onDrawSection}
        title="A named unit of the property (e.g. North Ridge) you can attach burn and timber plans to"
      >
        Draw section
      </button>

      <details className="dropdown">
        <summary className={disabled ? 'disabled' : ''}>Draw area ▾</summary>
        <div className="dropdown-menu">
          {(Object.keys(AREA_TYPES) as AreaType[]).map((type) => (
            <button key={type} onClick={(e) => pick(e, () => onDrawArea(type))}>
              <span className="swatch" style={{ background: AREA_TYPES[type].color }} />
              {AREA_TYPES[type].label}
            </button>
          ))}
        </div>
      </details>

      <details className="dropdown">
        <summary className={disabled ? 'disabled' : ''}>Add pin ▾</summary>
        <div className="dropdown-menu">
          {(Object.keys(MARKER_TYPES) as MarkerType[]).map((type) => (
            <button key={type} onClick={(e) => pick(e, () => onPlaceMarker(type))}>
              <span className="swatch round" style={{ background: MARKER_TYPES[type].color }} />
              {MARKER_TYPES[type].label}
            </button>
          ))}
        </div>
      </details>

      <input
        ref={fileInput}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImport(file);
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onAddImage(file);
        }}
      />
    </div>
  );
}
