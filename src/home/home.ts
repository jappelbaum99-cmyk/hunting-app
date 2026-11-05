import '../wordmark.css';
import './home.css';

import { iconSvg, type IconName } from '@/lib/icons';

for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = iconSvg(el.dataset.icon as IconName, 22);

// The installer is attached to the newest GitHub release under this name
// (see the release workflow). On GitHub Pages the site lives at
// <owner>.github.io/<repo>/, so the release link is worked out from the address.
const INSTALLER = 'Hunting-Hub-Setup.exe';

const download = document.getElementById('download') as HTMLAnchorElement;
const note = document.getElementById('download-note')!;
const phoneLink = document.getElementById('phone-link')!;

const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : null;
const repo = location.pathname.split('/').filter(Boolean)[0] ?? null;

if (owner && repo) {
  download.href = `https://github.com/${owner}/${repo}/releases/latest/download/${INSTALLER}`;
} else {
  download.removeAttribute('href');
  download.classList.add('disabled');
  note.textContent = 'The download link works once the site is on GitHub Pages.';
}

phoneLink.textContent = `Or type this on your phone: ${new URL('field.html', location.href).href}`;
