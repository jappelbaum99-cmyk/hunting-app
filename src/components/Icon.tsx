import { iconSvg, type IconName } from '@/lib/icons';

// One of the app's own icons (src/lib/icons.ts), in the current text color.
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  // The SVG strings are fixed in the app's own code, never user input.
  return <span className={`icon-wrap${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }} />;
}
