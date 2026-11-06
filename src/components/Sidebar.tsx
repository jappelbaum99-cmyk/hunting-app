import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { isHuntingSpot, pinTypeInfo } from '@/lib/featureTypes';
import { AreaBadge } from '@/components/AreaBadge';
import { Icon } from '@/components/Icon';
import { areaTypeInfo, markerStyle, propertyColor } from '@/lib/styles';
import { acresOf, formatAcres } from '@/lib/geo';
import { daySummary, huntsByDay, isLive } from '@/lib/huntStats';
import { FIELD_PAGE_URL } from '@/lib/site';
import { huntPlaceName } from '@/lib/reports';
import { formatDistance, lineLengthM, metersBetween, trailKindInfo, trailStyle } from '@/lib/trails';
import { sightingSummary } from '@/lib/reports';
import type { CampLink, FieldPin, FieldTrack, MapTrail, HubSettings, HuntReport, MapArea, MapImageOverlay, MapMarker, Plan, Property, Section, Selection } from '@/types/models';

interface SidebarProps {
  properties: Property[];
  sections: Section[];
  plans: Plan[];
  reports: HuntReport[];
  onLogHunt(): void;
  // GPS pins from the phone that haven't been added or dismissed yet.
  newFieldPins: FieldPin[];
  // The camp phones send hunts and pins to, and the last problem reaching it.
  camp: CampLink | null;
  campError: string | null;
  // Map files for sharing with someone else's hub.
  onExportMap(): void;
  onImportMap(file: File): void;
  onFieldPin(id: string, action: 'show' | 'add' | 'dismiss'): void;
  // Walks recorded on phones that haven't been added or dismissed yet.
  newFieldTracks: FieldTrack[];
  onFieldTrack(id: string, action: 'show' | 'add' | 'dismiss'): void;
  trails: MapTrail[];
  areas: MapArea[];
  markers: MapMarker[];
  overlays: MapImageOverlay[];
  selection: Selection | null;
  dataPath: string | null;
  // A full view (Hunt Forecast, Settings) shown in place of the lists; null when none is open.
  view: ReactNode | null;
  // One-line summary for the Hunt Forecast card, e.g. "NW 8 mph · 2 good stands".
  forecastTeaser: string;
  onOpenForecast(): void;
  // One-line summary for the Trail Cameras card.
  cameraTeaser: string;
  onOpenCameras(): void;
  // One-line summary for the Summary card, e.g. "241 ac · 3 stands · 12 hunts".
  summaryTeaser: string;
  onOpenSummary(): void;
  // One-line summary for the Action Board card, e.g. "2 to do · 3 ideas".
  boardTeaser: string;
  onOpenBoard(): void;
  onOpenSettings(): void;
  settings: HubSettings;
  onPick(selection: Selection): void;
  onShowDataFolder: (() => void) | null;
  // Dragging the right edge changes the width; double-click puts it back.
  width: number;
  onResize(width: number): void;
  onResizeEnd(width: number): void;
}

// Swap public/logo.svg (or point this at another file in public/) to change the logo.
const LOGO_URL = `${import.meta.env.BASE_URL}logo.svg`;

// The sidebar's width in pixels: the default, and how narrow or wide it can be dragged.
export const SIDEBAR_WIDTH = { default: 300, min: 260, max: 640 };

// Days of hunts listed before "Show older".
const DAYS_SHOWN = 7;
const REPORTS_OPEN_KEY = 'hunting-hub-reports-open';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true });

export function Sidebar(props: SidebarProps) {
  const { properties, areas, markers, overlays, selection, dataPath, onPick, onShowDataFolder } = props;
  const [query, setQuery] = useState('');
  const mapInput = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = <T extends { name: string }>(list: T[]) =>
    [...list].filter((r) => !needle || r.name.toLowerCase().includes(needle)).sort(byName);

  const isSelected = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;
  const isStand = (m: MapMarker) => isHuntingSpot(m.type, props.settings.customPinTypes);
  const shownProperties = matches(properties);
  const stands = matches(markers.filter(isStand));
  const otherPins = matches(markers.filter((m) => !isStand(m)));
  const shownAreas = matches(areas);
  const shownOverlays = matches(overlays);
  const shownSections = matches(props.sections);
  const shownTrails = matches(props.trails);

  const nothingFound =
    needle !== '' &&
    shownProperties.length + shownSections.length + stands.length + otherPins.length + shownAreas.length + shownOverlays.length === 0;
  const planSummary = (sectionId: string) => {
    const open = props.plans.filter((p) => p.sectionId === sectionId && p.status !== 'done').length;
    return open === 0 ? 'no plans' : `${open} plan${open === 1 ? '' : 's'}`;
  };

  return (
    <aside className="sidebar">
      <ResizeHandle width={props.width} onResize={props.onResize} onResizeEnd={props.onResizeEnd} />
      <header className="sidebar-header">
        <div className="brand">
          <img src={LOGO_URL} alt="" />
          <h1>Fenceline</h1>
          <button className="icon settings-button" onClick={props.onOpenSettings} title="Settings" aria-label="Settings">
            {/* Gear: a toothed wheel with a hole in the middle. */}
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7c.1.6.1 1.2 0 1.8l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.7a6 6 0 0 1 0-1.8l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9L10.3 2Zm1.7 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z"
                transform="translate(0 1.2)"
              />
            </svg>
          </button>
        </div>
        {props.view === null && (
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

      <div className="sidebar-scroll">{props.view ?? renderLists()}</div>

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
          <button className="forecast-card camera-card" onClick={props.onOpenCameras}>
            <span className="forecast-card-icon" aria-hidden>
              <Icon name="camera" size={20} />
            </span>
            <span className="forecast-card-text">
              <span className="row-title">Trail Cameras</span>
              <span className="row-detail">{props.cameraTeaser}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </button>
        )}

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

        {needle === '' && (
          <button className="forecast-card summary-card" onClick={props.onOpenSummary}>
            <span className="forecast-card-icon" aria-hidden>
              <Icon name="chart" size={20} />
            </span>
            <span className="forecast-card-text">
              <span className="row-title">Summary</span>
              <span className="row-detail">{props.summaryTeaser}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </button>
        )}

        {needle === '' && (
          <button className="forecast-card summary-card" onClick={props.onOpenBoard}>
            <span className="forecast-card-icon" aria-hidden>
              <Icon name="clipboard" size={20} />
            </span>
            <span className="forecast-card-text">
              <span className="row-title">Action Board</span>
              <span className="row-detail">{props.boardTeaser}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </button>
        )}

        {nothingFound && <p className="empty">Nothing matches “{query.trim()}”.</p>}

        {needle === '' && (
          <PhoneDrop camp={props.camp} campError={props.campError} newCount={props.newFieldPins.length + props.newFieldTracks.length} onOpenSettings={props.onOpenSettings}>
            {props.newFieldTracks.length > 0 && (
              <ul>
                {props.newFieldTracks.map((t) => (
                  <li key={t.id} className="field-pin-row">
                    <button className="row" onClick={() => props.onFieldTrack(t.id, 'show')}>
                      <span className="swatch line dashed" style={{ '--line': '#f7efe6' } as CSSProperties} />
                      <span className="row-title">{t.name}</span>
                      <span className="row-detail">
                        {t.loggedBy ? `${t.loggedBy} · ` : ''}
                        {formatDistance(t.lengthM)}
                      </span>
                    </button>
                    <button className="mini primary" onClick={() => props.onFieldTrack(t.id, 'add')} title="Make it a trail on the map">
                      Add
                    </button>
                    <button className="mini" onClick={() => props.onFieldTrack(t.id, 'dismiss')} title="Dismiss" aria-label="Dismiss walk">
                      <Icon name="close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {props.newFieldPins.length > 0 && (
              <ul>
                {props.newFieldPins.map((p) => {
                  const stand = p.moveStandId ? markers.find((m) => m.id === p.moveStandId) : undefined;
                  return (
                    <li key={p.id} className="field-pin-row">
                      <button className="row" onClick={() => props.onFieldPin(p.id, 'show')}>
                        <span className="swatch" style={{ background: pinTypeInfo(stand?.type ?? p.type, props.settings.customPinTypes).color }} />
                        {stand ? (
                          <span className="row-title">
                            New spot for {stand.name}
                            {p.loggedBy ? ` · ${p.loggedBy}` : ''}
                          </span>
                        ) : (
                          <span className="row-title">
                            {pinTypeInfo(p.type, props.settings.customPinTypes).label}
                            {p.note ? ` · ${p.note}` : ''}
                          </span>
                        )}
                        <span className="row-detail">
                          {stand
                            ? `${Math.round(metersBetween([stand.lng, stand.lat], [p.lng, p.lat]) * 1.09361)} yd away`
                            : p.accuracyM !== null
                              ? `±${p.accuracyM} m`
                              : ''}
                        </span>
                      </button>
                      <button
                        className="mini primary"
                        onClick={() => props.onFieldPin(p.id, 'add')}
                        title={stand ? `Move ${stand.name} to this spot` : 'Add to the map'}
                      >
                        {stand ? 'Move' : 'Add'}
                      </button>
                      <button className="mini" onClick={() => props.onFieldPin(p.id, 'dismiss')} title="Dismiss">
                        <Icon name="close" size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </PhoneDrop>
        )}

        {needle === '' && (
          <HuntReports
            reports={props.reports}
            markers={markers}
            isSelected={(id) => isSelected('report', id)}
            onPick={(id) => onPick({ kind: 'report', id })}
            onLogHunt={props.onLogHunt}
          />
        )}

        <Section title="Hunting Locations" count={stands.length} searching={needle !== ''} empty="Add a stand, blind or platform from Add pin.">
          {stands.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch" style={{ background: markerStyle(m, props.settings).color }} />}
              title={m.name}
              detail={m.goodWinds.length ? m.goodWinds.join(' ') : 'no winds set'}
            />
          ))}
        </Section>

        <Section title="Properties" count={shownProperties.length} searching={needle !== ''} empty="Draw your property line or import a KML file.">
          {shownProperties.map((p) => (
            <Row
              key={p.id}
              selected={isSelected('property', p.id)}
              onClick={() => onPick({ kind: 'property', id: p.id })}
              swatch={<span className="swatch outline" style={{ '--line': propertyColor(p, props.settings) } as CSSProperties} />}
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

        <Section title="Areas" count={shownAreas.length} searching={needle !== ''} empty="Draw food plots, bedding and sanctuaries.">
          {shownAreas.map((a) => (
            <Row
              key={a.id}
              selected={isSelected('area', a.id)}
              onClick={() => onPick({ kind: 'area', id: a.id })}
              swatch={<AreaBadge type={areaTypeInfo(a.type, props.settings)} />}
              title={a.name}
              detail={a.planted ? `${a.planted} · ${formatAcres(acresOf(a.geometry))}` : formatAcres(acresOf(a.geometry))}
            />
          ))}
        </Section>

        <Section title="Other Pins" count={otherPins.length} searching={needle !== ''} empty="Cameras, scrapes, rubs, water and parking.">
          {otherPins.map((m) => (
            <Row
              key={m.id}
              selected={isSelected('marker', m.id)}
              onClick={() => onPick({ kind: 'marker', id: m.id })}
              swatch={<span className="swatch" style={{ background: markerStyle(m, props.settings).color }} />}
              title={m.name}
              detail={pinTypeInfo(m.type, props.settings.customPinTypes).label}
            />
          ))}
        </Section>

        <Section title="Trails" count={shownTrails.length} searching={needle !== ''} empty="Draw deer trails, paths, roads and fence lines, or walk one with the phone.">
          {shownTrails.map((t) => (
            <Row
              key={t.id}
              selected={isSelected('trail', t.id)}
              onClick={() => onPick({ kind: 'trail', id: t.id })}
              swatch={<span className={`swatch line ${trailStyle(t).pattern}`} style={{ '--line': t.color ?? trailKindInfo(t.kind).color, borderTopWidth: Math.max(2, trailStyle(t).px) } as CSSProperties} />}
              title={t.name}
              detail={`${trailKindInfo(t.kind).label} · ${formatDistance(lineLengthM(t.line.coordinates))}`}
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

        {needle === '' && (
          <section className="sidebar-section">
            <h2>Share</h2>
            <div className="phone-buttons">
              <button onClick={props.onExportMap} title="Save every property, pin, area, plan, hunt and map image as one file to send">
                Export whole map
              </button>
              <button onClick={() => mapInput.current?.click()} title="Bring in a map file someone sent you. Anything already here is kept unless theirs is newer.">
                Import a map file
              </button>
            </div>
            <p className="share-hint">To share one property, open it and press Share.</p>
            <input
              ref={mapInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) props.onImportMap(file);
              }}
            />
          </section>
        )}
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

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Hunt Reports: folded into a dropdown, except for anyone in the stand right now.
function HuntReports(props: {
  reports: HuntReport[];
  markers: MapMarker[];
  isSelected(id: string): boolean;
  onPick(id: string): void;
  onLogHunt(): void;
}) {
  const { reports, markers } = props;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(REPORTS_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showAll, setShowAll] = useState(false);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(REPORTS_OPEN_KEY, open ? '0' : '1');
    } catch {
      // Only a convenience; the list still works.
    }
  };

  const standName = (r: HuntReport) => huntPlaceName(r, markers);
  const live = reports.filter((r) => isLive(r)).sort((a, b) => a.start.localeCompare(b.start));
  const days = huntsByDay(reports.filter((r) => !isLive(r)));
  const shownDays = showAll ? days : days.slice(0, DAYS_SHOWN);

  return (
    <section className="sidebar-section hunt-reports">
      <button className="section-toggle" onClick={toggle} aria-expanded={open}>
        <h2>
          Hunt Reports <span className="count">{reports.length}</span>
        </h2>
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>

      {live.length > 0 && (
        <ul className="live-hunts">
          {live.map((r) => (
            <Row
              key={r.id}
              selected={props.isSelected(r.id)}
              onClick={() => props.onPick(r.id)}
              swatch={<span className="live-dot" title="In the stand now" />}
              title={`${r.loggedBy ? `${r.loggedBy} · ` : ''}${standName(r)}`}
              detail={`In since ${clock(r.start)} · ${sightingSummary(r)}`}
            />
          ))}
        </ul>
      )}

      {!open && days.length > 0 && (
        <button className="reports-teaser" onClick={toggle}>
          <span>{days[0].label}</span>
          <span className="muted">{daySummary(days[0])}</span>
        </button>
      )}

      {open && (
        <>
          <button className="log-hunt" onClick={props.onLogHunt}>
            + Log a hunt
          </button>
          {shownDays.map((day) => (
            <div key={day.key} className="hunt-day">
              <div className="hunt-day-head">
                <span>{day.label}</span>
                <span className="muted">{daySummary(day)}</span>
              </div>
              <ul>
                {day.reports.map((r) => (
                  <Row
                    key={r.id}
                    selected={props.isSelected(r.id)}
                    onClick={() => props.onPick(r.id)}
                    swatch={
                      <span className="swatch report">
                        <Icon name="track" size={16} />
                      </span>
                    }
                    title={standName(r)}
                    detail={`${clock(r.start)}${r.loggedBy ? ` · ${r.loggedBy}` : ''} · ${sightingSummary(r)}`}
                  />
                ))}
              </ul>
            </div>
          ))}
          {days.length > DAYS_SHOWN && (
            <button className="link-button show-older" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer days' : `Show ${days.length - DAYS_SHOWN} older days`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// The grab strip on the sidebar's right edge.
function ResizeHandle(props: { width: number; onResize(width: number): void; onResizeEnd(width: number): void }) {
  const clamp = (w: number) => Math.round(Math.min(Math.min(SIDEBAR_WIDTH.max, window.innerWidth * 0.6), Math.max(SIDEBAR_WIDTH.min, w)));
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize the sidebar. Double-click to reset."
      aria-valuenow={props.width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: props.width, width: props.width };
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.width = clamp(drag.current.startWidth + e.clientX - drag.current.startX);
        props.onResize(drag.current.width);
      }}
      onPointerUp={() => {
        if (drag.current) props.onResizeEnd(drag.current.width);
        drag.current = null;
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={() => {
        props.onResize(SIDEBAR_WIDTH.default);
        props.onResizeEnd(SIDEBAR_WIDTH.default);
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0;
        if (!step) return;
        const next = clamp(props.width + step);
        props.onResize(next);
        props.onResizeEnd(next);
      }}
    />
  );
}

// The Join the Camp section: how to join from a phone (web address and camp code),
// plus walks and pins waiting to be added. Opens by itself when something new arrives.
function PhoneDrop(props: { camp: CampLink | null; campError: string | null; newCount: number; onOpenSettings(): void; children: ReactNode }) {
  const [open, setOpen] = useState(props.newCount > 0);
  const [copied, setCopied] = useState<string | null>(null);
  const seen = useRef(props.newCount);
  useEffect(() => {
    if (props.newCount > seen.current) setOpen(true);
    seen.current = props.newCount;
  }, [props.newCount]);

  const copy = (what: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <section className="sidebar-section phone-drop">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>
          Join the Camp <span className="count">{props.newCount ? `${props.newCount} new` : props.camp ? props.camp.name : ''}</span>
        </h2>
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="phone-join">
          <ol>
            <li>
              On the phone, open
              <span className="copy-row">
                <code>{FIELD_PAGE_URL.replace('https://', '')}</code>
                <button className="mini" onClick={() => copy('url', FIELD_PAGE_URL)}>
                  {copied === 'url' ? 'Copied' : 'Copy'}
                </button>
              </span>
              <span className="muted">In Safari, Share › Add to Home Screen.</span>
            </li>
            {props.camp ? (
              <li>
                On its Camp tab, enter a name and the camp code
                <span className="copy-row">
                  <code className="camp-code-text">{props.camp.code}</code>
                  <button className="mini" onClick={() => copy('code', props.camp!.code)}>
                    {copied === 'code' ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </li>
            ) : (
              <li>
                <button className="link-button" onClick={props.onOpenSettings}>
                  Start camp sync in Settings
                </button>{' '}
                to get a camp code. Until then, phones send files (Settings › Phone files).
              </li>
            )}
          </ol>
          {props.camp && (
            <p className="camp-live">
              <Icon name="camp" size={15} /> Hunts, pins and walks from <strong>{props.camp.name}</strong> arrive by themselves.
              {props.campError && <span className="error-text"> Can't reach camp right now ({props.campError}).</span>}
            </p>
          )}
          {props.children}
        </div>
      )}
    </section>
  );
}
