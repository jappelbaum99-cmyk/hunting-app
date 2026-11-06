import { pinTypeList } from '@/lib/featureTypes';
import { areaTypeList, LABEL_KINDS } from '@/lib/styles';
import type { HubSettings, LabelKind } from '@/types/models';

// Which names show on the map: each kind of thing, with stands and pins and
// areas broken down by type.
export function MapLabelToggles({ settings, onChange }: { settings: HubSettings; onChange(settings: HubSettings): void }) {
  const pinTypes = pinTypeList(settings.customPinTypes);
  const areaTypes = areaTypeList(settings);
  const toggleKind = (kind: LabelKind, show: boolean) =>
    onChange({ ...settings, hiddenLabels: show ? settings.hiddenLabels.filter((k) => k !== kind) : [...settings.hiddenLabels, kind] });
  const toggleType = (key: string, show: boolean) =>
    onChange({ ...settings, hiddenTypeLabels: show ? settings.hiddenTypeLabels.filter((k) => k !== key) : [...settings.hiddenTypeLabels, key] });

  const kindRow = (kind: LabelKind, label: string) => (
    <label className="check" key={kind}>
      <input type="checkbox" checked={!settings.hiddenLabels.includes(kind)} onChange={(e) => toggleKind(kind, e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const typeRows = (kind: LabelKind, types: { id: string; label: string }[]) =>
    !settings.hiddenLabels.includes(kind) && (
      <div className="label-types">
        {types.map(({ id, label }) => {
          const key = `${kind}:${id}`;
          return (
            <label className="check" key={key}>
              <input type="checkbox" checked={!settings.hiddenTypeLabels.includes(key)} onChange={(e) => toggleType(key, e.target.checked)} />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    );

  return (
    <div className="label-toggles">
      <div className="label-toggle-actions">
        <button onClick={() => onChange({ ...settings, hiddenLabels: [], hiddenTypeLabels: [] })}>Show all</button>
        <button onClick={() => onChange({ ...settings, hiddenLabels: LABEL_KINDS.map((k) => k.id) })}>Hide all</button>
      </div>
      {LABEL_KINDS.map(({ id, label }) => (
        <div key={id}>
          {kindRow(id, label)}
          {id === 'pin' && typeRows('pin', pinTypes)}
          {id === 'area' && typeRows('area', areaTypes)}
        </div>
      ))}
      <p className="hint">A selected stand, pin, area or hunt spot still shows its name.</p>
    </div>
  );
}
