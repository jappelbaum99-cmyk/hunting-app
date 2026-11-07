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

  // "My default": the choices saved below, which Show all and Hide all don't touch.
  const saved = settings.labelDefault ?? null;
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));
  const onDefault = saved !== null && sameList(saved.hiddenLabels, settings.hiddenLabels) && sameList(saved.hiddenTypeLabels, settings.hiddenTypeLabels);

  return (
    <div className="label-toggles">
      <div className="label-toggle-actions">
        <button onClick={() => onChange({ ...settings, hiddenLabels: [], hiddenTypeLabels: [] })}>Show all</button>
        <button onClick={() => onChange({ ...settings, hiddenLabels: LABEL_KINDS.map((k) => k.id) })}>Hide all</button>
        <button
          className={onDefault ? 'active' : undefined}
          disabled={saved === null}
          title={saved === null ? 'Set the names the way you like, then save them as your default below' : 'Back to the names you saved'}
          onClick={() => saved && onChange({ ...settings, hiddenLabels: [...saved.hiddenLabels], hiddenTypeLabels: [...saved.hiddenTypeLabels] })}
        >
          My default
        </button>
      </div>
      {onDefault ? (
        <p className="hint label-default-note">Showing your default.</p>
      ) : (
        <button
          className="link-button label-default-save"
          onClick={() => onChange({ ...settings, labelDefault: { hiddenLabels: [...settings.hiddenLabels], hiddenTypeLabels: [...settings.hiddenTypeLabels] } })}
        >
          {saved === null ? 'Save these as my default' : 'Save these as my new default'}
        </button>
      )}
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
