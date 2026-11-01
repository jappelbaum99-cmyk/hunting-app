import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import { acresOf, formatAcres } from '@/lib/geo';
import type { MapArea, MapImageOverlay, MapMarker, Property, Selection } from '@/types/models';

interface SidebarProps {
  properties: Property[];
  areas: MapArea[];
  markers: MapMarker[];
  overlays: MapImageOverlay[];
  selection: Selection | null;
  dataPath: string | null;
  onPick(selection: Selection): void;
  onShowDataFolder: (() => void) | null;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function Sidebar({ properties, areas, markers, overlays, selection, dataPath, onPick, onShowDataFolder }: SidebarProps) {
  const isSelected = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;
  const stands = markers.filter((m) => m.type === 'stand' || m.type === 'blind').sort(byName);
  const otherPins = markers.filter((m) => m.type !== 'stand' && m.type !== 'blind').sort(byName);

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <h1>Hunting Hub</h1>
      </header>

      <div className="sidebar-scroll">
        <Section title="Properties" count={properties.length} empty="Draw your property line or import a KML file.">
          {[...properties].sort(byName).map((p) => (
            <Row
              key={p.id}
              selected={isSelected('property', p.id)}
              onClick={() => onPick({ kind: 'property', id: p.id })}
              swatch={<span className="swatch outline" />}
              title={p.name}
              detail={formatAcres(acresOf(p.boundary))}
            />
          ))}
        </Section>

        <Section title="Stands & blinds" count={stands.length} empty="Add a stand pin from the toolbar.">
          {stands.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch round" style={{ background: MARKER_TYPES[m.type].color }} />}
              title={m.name}
              detail={m.goodWinds.length ? m.goodWinds.join(' ') : 'no winds set'}
            />
          ))}
        </Section>

        <Section title="Areas" count={areas.length} empty="Draw food plots, bedding and sanctuaries.">
          {[...areas].sort(byName).map((a) => (
            <Row
              key={a.id}
              selected={isSelected('area', a.id)}
              onClick={() => onPick({ kind: 'area', id: a.id })}
              swatch={<span className="swatch" style={{ background: AREA_TYPES[a.type].color }} />}
              title={a.name}
              detail={formatAcres(acresOf(a.geometry))}
            />
          ))}
        </Section>

        <Section title="Other pins" count={otherPins.length} empty="Cameras, scrapes, rubs, water and parking.">
          {otherPins.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch round" style={{ background: MARKER_TYPES[m.type].color }} />}
              title={m.name}
              detail={MARKER_TYPES[m.type].label}
            />
          ))}
        </Section>

        <Section title="Map images" count={overlays.length} empty="Lay a parcel map screenshot over the map to trace from.">
          {[...overlays].sort(byName).map((o) => (
            <Row
              key={o.id}
              selected={isSelected('overlay', o.id)}
              onClick={() => onPick({ kind: 'overlay', id: o.id })}
              swatch={<span className="swatch image" />}
              title={o.name}
              detail={o.visible ? `${Math.round(o.opacity * 100)}%` : 'hidden'}
            />
          ))}
        </Section>
      </div>

      <footer className="sidebar-footer">
        {dataPath ? (
          <button className="link" onClick={onShowDataFolder ?? undefined} title={dataPath}>
            Saved to Documents\Hunting Hub
          </button>
        ) : (
          <span>Browser preview: data is saved in this browser only.</span>
        )}
      </footer>
    </aside>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="sidebar-section">
      <h2>
        {title} <span className="count">{count}</span>
      </h2>
      {count === 0 ? <p className="empty">{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}

function Row(props: { selected: boolean; onClick(): void; swatch: React.ReactNode; title: string; detail: string }) {
  return (
    <li>
      <button className={`row${props.selected ? ' selected' : ''}`} onClick={props.onClick}>
        {props.swatch}
        <span className="row-title">{props.title}</span>
        <span className="row-detail">{props.detail}</span>
      </button>
    </li>
  );
}
