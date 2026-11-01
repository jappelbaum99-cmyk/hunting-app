import type { AreaTypeView } from '@/lib/styles';

// An area type's color with its icon on top, for lists and menus.
export function AreaBadge({ type, size = 24 }: { type: Pick<AreaTypeView, 'color' | 'icon'>; size?: number }) {
  return (
    <span className="area-badge" style={{ background: type.color, width: size, height: size, fontSize: Math.round(size * 0.58) }}>
      {type.icon}
    </span>
  );
}
