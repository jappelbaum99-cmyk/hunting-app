import { useState } from 'react';

import { Icon } from '@/components/Icon';
import type { FieldData } from '@/field/fieldData';
import { SentBadge, type SentStatus } from '@/field/SentTools';
import { NOTE_KINDS } from '@/lib/actionBoard';
import { FOOD_PLOT_CROPS } from '@/lib/featureTypes';
import { PLOT_ACTIONS, todayDate } from '@/lib/plotLog';
import type { FieldNote, NoteKind, PlotAction } from '@/types/models';

type Pick = NoteKind | 'plot';

const PICKS: { id: Pick; label: string }[] = [
  { id: 'stand', label: NOTE_KINDS.stand },
  { id: 'work', label: NOTE_KINDS.work },
  { id: 'thought', label: NOTE_KINDS.thought },
  { id: 'plot', label: 'Food plot work' },
];

// Send an idea or work to do to the hub's Action Board, or log work on a food
// plot. The board itself stays on the hubs. Works with no signal: notes wait on the phone.
export function NotesTab(props: {
  data: FieldData;
  fix: { lat: number; lng: number; accuracyM: number } | null;
  gpsError: string | null;
  status(item: { id: string; updatedAt: string }): SentStatus;
  onAdd(note: FieldNote): void;
  onRemove(id: string): void;
  onMessage(m: string): void;
}) {
  const { data, fix } = props;
  const [pick, setPick] = useState<Pick>('stand');
  const [text, setText] = useState('');
  const [useSpot, setUseSpot] = useState(true);
  const [areaId, setAreaId] = useState('');
  const [action, setAction] = useState<PlotAction>('planted');
  const [what, setWhat] = useState('');
  const [date, setDate] = useState(todayDate);

  const onPlot = pick === 'plot';
  const plots = [...data.plots].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const plot = plots.find((p) => p.id === areaId) ?? (plots.length === 1 ? plots[0] : null);
  const ready = onPlot ? plot !== null && date !== '' && (action !== 'planted' || what.trim() !== '') : text.trim() !== '';

  const save = () => {
    if (!ready) return;
    const at = new Date().toISOString();
    const spot = useSpot && fix ? { lat: fix.lat, lng: fix.lng } : { lat: null, lng: null };
    props.onAdd({
      id: crypto.randomUUID(),
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      kind: onPlot ? 'work' : pick,
      text: text.trim(),
      ...spot,
      loggedBy: data.camp?.hunter ?? null,
      plot: onPlot && plot ? { areaId: plot.id, action, what: action === 'planted' ? what.trim() : null, date } : null,
    });
    setText('');
    setWhat('');
    props.onMessage(data.camp ? 'Saved. It goes to camp as soon as you have signal.' : 'Saved on this phone. Send it to the hub from the Send tab.');
  };

  return (
    <>
      <section className="field-card">
        <h2>Notes</h2>
        <div className="note-kinds" role="radiogroup" aria-label="Kind of note">
          {PICKS.map(({ id, label }) => (
            <button key={id} role="radio" aria-checked={pick === id} className={pick === id ? 'active' : ''} onClick={() => setPick(id)}>
              {label}
            </button>
          ))}
        </div>

        {onPlot &&
          (plots.length === 0 ? (
            <p className="field-hint">{data.camp ? 'Food plots show up here once the hub that runs your camp has opened with this version.' : 'Join your camp (Camp tab) to log work on a food plot.'}</p>
          ) : (
            <>
              <select className="note-input" value={plot?.id ?? ''} onChange={(e) => setAreaId(e.target.value)} aria-label="Food plot">
                <option value="" disabled>
                  Pick a food plot
                </option>
                {plots.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.planted ? ` (${p.planted})` : ''}
                  </option>
                ))}
              </select>
              <div className="note-row">
                <select className="note-input" value={action} onChange={(e) => setAction(e.target.value as PlotAction)} aria-label="What was done">
                  {(Object.keys(PLOT_ACTIONS) as PlotAction[]).map((a) => (
                    <option key={a} value={a}>
                      {PLOT_ACTIONS[a]}
                    </option>
                  ))}
                </select>
                <input className="note-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              </div>
              {action === 'planted' && (
                <>
                  <input className="note-input" type="text" list="note-crops" placeholder="What you planted" value={what} onChange={(e) => setWhat(e.target.value)} aria-label="What you planted" />
                  <datalist id="note-crops">
                    {FOOD_PLOT_CROPS.map((crop) => (
                      <option key={crop} value={crop} />
                    ))}
                  </datalist>
                </>
              )}
            </>
          ))}

        <textarea
          className="note-input"
          rows={4}
          placeholder={onPlot ? 'Notes, like seed rate or how it went' : pick === 'stand' ? 'Where and why, like "the bench above the creek"' : pick === 'work' ? 'What needs doing' : "What's on your mind"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Note"
        />

        {!onPlot && (
          <label className="note-check">
            <input type="checkbox" checked={useSpot} onChange={(e) => setUseSpot(e.target.checked)} />
            <span>{fix ? `Mark this spot (GPS ±${Math.round(fix.accuracyM)} m)` : props.gpsError ? 'Mark this spot (GPS is off)' : 'Mark this spot (finding GPS…)'}</span>
          </label>
        )}

        <button className="big-button" disabled={!ready} onClick={save}>
          Save note
        </button>
      </section>

      {data.notes.length > 0 && (
        <section className="field-card note-section">
          <h3>Waiting to reach the hub</h3>
          <ul className="note-list">
            {data.notes.map((note) => (
              <li key={note.id}>
                <div className="note-text">
                  <strong>{note.plot ? `${PLOT_ACTIONS[note.plot.action]}${note.plot.what ? ` ${note.plot.what}` : ''}` : NOTE_KINDS[note.kind]}</strong>
                  {note.text && <span>{note.text}</span>}
                  <SentBadge status={props.status(note)} />
                </div>
                <button className="note-remove" aria-label="Remove note" onClick={() => props.onRemove(note.id)}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
