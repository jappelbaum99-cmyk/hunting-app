import { useState, type ReactNode } from 'react';

import { AREA_TYPES, MARKER_TYPES } from '@/lib/featureTypes';
import { acresOf, formatAcres } from '@/lib/geo';
import type { MapArea, MapImageOverlay, MapMarker, Plan, Property, Section, Selection } from '@/types/models';

interface SidebarProps {
  properties: Property[];
  sections: Section[];
  plans: Plan[];
  areas: MapArea[];
  markers: MapMarker[];
  overlays: MapImageOverlay[];
  selection: Selection | null;
  dataPath: string | null;
  // The open Hunt Forecast view, shown in place of the lists; null when closed.
  forecastView: ReactNode | null;
  // One-line summary for the Hunt Forecast card, e.g. "NW 8 mph · 2 good stands".
  forecastTeaser: string;
  onOpenForecast(): void;
  onPick(selection: Selection): void;
  onShowDataFolder: (() => void) | null;
}

// Swap public/logo.svg (or point this at another file in public/) to change the logo.
const LOGO_URL = `${import.meta.env.BASE_URL}logo.svg`;

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function Sidebar(props: SidebarProps) {
  const { properties, areas, markers, overlays, selection, dataPath, onPick, onShowDataFolder } = props;
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = <T extends { name: string }>(list: T[]) =>
    [...list].filter((r) => !needle || r.name.toLowerCase().includes(needle)).sort(byName);

  const isSelected = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;
  const isStand = (m: MapMarker) => m.type === 'stand' || m.type === 'blind';
  const shownProperties = matches(properties);
  const stands = matches(markers.filter(isStand));
  const otherPins = matches(markers.filter((m) => !isStand(m)));
  const shownAreas = matches(areas);
  const shownOverlays = matches(overlays);
  const shownSections = matches(props.sections);
  const nothingFound =
    needle !== '' &&
    shownProperties.length + shownSections.length + stands.length + otherPins.length + shownAreas.length + shownOverlays.length === 0;
  const planSummary = (sectionId: string) => {
    const open = props.plans.filter((p) => p.sectionId === sectionId && p.status !== 'done').length;
    return open === 0 ? 'no plans' : `${open} plan${open === 1 ? '' : 's'}`;
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand">
          <img src={LOGO_URL} alt="" />
          <h1>Hunting Hub</h1>
        </div>
        {props.forecastView === null && (
          <label className="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m20 20-4.8-4.8" />
            </svg>
            <input
              type="search"
              placeholder="Search properties, stands, areas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </label>
        )}
      </header>

      <div className="sidebar-scroll">{props.forecastView ?? renderLists()}</div>

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

  function renderLists() {
    return (
      <>
        {needle === '' && (
          <button className="forecast-card" onClick={props.onOpenForecast}>
            <span className="forecast-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8h11a3 3 0 1 0-3-3" />
                <path d="M3 12h15a3 3 0 1 1-3 3" />
                <path d="M3 16h7" />
              </svg>
            </span>
            <span className="forecast-card-text">
              <span className="row-title">Hunt Forecast</span>
              <span className="row-detail">{props.forecastTeaser}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </button>
        )}

        {nothingFound && <p className="empty">Nothing matches “{query.trim()}”.</p>}

        <Section title="Properties" count={shownProperties.length} searching={needle !== ''} empty="Draw your property line or import a KML file.">
          {shownProperties.map((p) => (
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

        <Section title="Sections" count={shownSections.length} searching={needle !== ''} empty="Split a property into named units to plan burns and timber work.">
          {shownSections.map((s) => (
            <Row
              key={s.id}
              selected={isSelected('section', s.id)}
              onClick={() => onPick({ kind: 'section', id: s.id })}
              swatch={<span className="swatch section" />}
              title={s.name}
              detail={`${formatAcres(acresOf(s.geometry))} · ${planSummary(s.id)}`}
            />
          ))}
        </Section>

        <Section title="Stands & Blinds" count={stands.length} searching={needle !== ''} empty="Add a stand pin from the toolbar.">
          {stands.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch" style={{ background: MARKER_TYPES[m.type].color }} />}
              title={m.name}
              detail={m.goodWinds.length ? m.goodWinds.join(' ') : 'no winds set'}
            />
          ))}
        </Section>

        <Section title="Areas" count={shownAreas.length} searching={needle !== ''} empty="Draw food plots, bedding and sanctuaries.">
          {shownAreas.map((a) => (
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

        <Section title="Other Pins" count={otherPins.length} searching={needle !== ''} empty="Cameras, scrapes, rubs, water and parking.">
          {otherPins.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch" style={{ background: MARKER_TYPES[m.type].color }} />}
              title={m.name}
              detail={MARKER_TYPES[m.type].label}
            />
          ))}
        </Section>

        <Section title="Map Images" count={shownOverlays.length} searching={needle !== ''} empty="Lay a parcel map screenshot over the map to trace from.">
          {shownOverlays.map((o) => (
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
      </>
    );
  }
}

interface SectionProps {
  title: string;
  count: number;
  // While searching, empty sections are hidden instead of showing their hint.
  searching: boolean;
  empty: string;
  children: ReactNode;
}

function Section({ title, count, searching, empty, children }: SectionProps) {
  if (searching && count === 0) return null;
  return (
    <section className="sidebar-section">
      <h2>
        {title} <span className="count">{count}</span>
      </h2>
      {count === 0 ? <p className="empty">{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}

function Row(props: { selected: boolean; onClick(): void; swatch: ReactNode; title: string; detail: string }) {
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
