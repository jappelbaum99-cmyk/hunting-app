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
  // A changed note, sent again in place of the old one.
  onUpdate(note: FieldNote): void;
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
  // The note being changed, until it's updated or the change is cancelled.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? (data.notes.find((n) => n.id === editingId) ?? null) : null;

  const onPlot = pick === 'plot';
  const plots = [...data.plots].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const plot = plots.find((p) => p.id === areaId) ?? (plots.length === 1 ? plots[0] : null);
  const ready = onPlot ? plot !== null && date !== '' && (action !== 'planted' || what.trim() !== '') : text.trim() !== '';

  const clearForm = () => {
    setText('');
    setWhat('');
    setEditingId(null);
  };

  // Puts a note waiting on this phone (or at camp) back in the form to change it.
  const startEdit = (note: FieldNote) => {
    setEditingId(note.id);
    setText(note.text);
    if (note.plot) {
      setPick('plot');
      setAreaId(note.plot.areaId);
      setAction(note.plot.action);
      setWhat(note.plot.what ?? '');
      setDate(note.plot.date);
    } else {
      setPick(note.kind);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = () => {
    if (!ready) return;
    const at = new Date().toISOString();
    if (editingId) {
      // The hub took it in while it was being changed: it's on the board now.
      if (!editing) {
        clearForm();
        props.onMessage('The hub already has that note, so change it on the Action Board.');
        return;
      }
      props.onUpdate({
        ...editing,
        updatedAt: at,
        kind: onPlot ? 'work' : pick,
        text: text.trim(),
        // Keeps the spot it was saved at.
        plot: onPlot && plot ? { areaId: plot.id, action, what: action === 'planted' ? what.trim() : null, date } : null,
      });
      clearForm();
      props.onMessage(data.camp ? 'Note changed. The new version goes to camp as soon as you have signal.' : 'Note changed on this phone.');
      return;
    }
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
    clearForm();
    props.onMessage(data.camp ? 'Saved. It goes to camp as soon as you have signal.' : 'Saved on this phone. Send it to the hub from the Send tab.');
  };

  return (
    <>
      <section className={`field-card${editingId ? ' note-editing' : ''}`}>
        <h2>{editingId ? 'Change note' : 'Notes'}</h2>
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

        {!onPlot && !editingId && (
          <label className="note-check">
            <input type="checkbox" checked={useSpot} onChange={(e) => setUseSpot(e.target.checked)} />
            <span>{fix ? `Mark this spot (GPS ±${Math.round(fix.accuracyM)} m)` : props.gpsError ? 'Mark this spot (GPS is off)' : 'Mark this spot (finding GPS…)'}</span>
          </label>
        )}

        <button className="big-button" disabled={!ready} onClick={save}>
          {editingId ? 'Update note' : 'Save note'}
        </button>
        {editingId && (
          <button className="end-button" onClick={clearForm}>
            Cancel change
          </button>
        )}
      </section>

      {data.notes.length > 0 && (
        <section className="field-card note-section">
          <h3>Waiting to reach the hub</h3>
          <ul className="note-list">
            {data.notes.map((note) => (
              <li key={note.id} className={note.id === editingId ? 'editing' : undefined}>
                <div className="note-text">
                  <strong>{note.plot ? `${PLOT_ACTIONS[note.plot.action]}${note.plot.what ? ` ${note.plot.what}` : ''}` : NOTE_KINDS[note.kind]}</strong>
                  {note.text && <span>{note.text}</span>}
                  <SentBadge status={props.status(note)} />
                </div>
                <button className="note-edit" onClick={() => startEdit(note)} disabled={note.id === editingId}>
                  Edit
                </button>
                <button
                  className="note-remove"
                  aria-label="Remove note"
                  onClick={() => {
                    if (note.id === editingId) clearForm();
                    props.onRemove(note.id);
                  }}
                >
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
