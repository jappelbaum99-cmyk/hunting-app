// Where the website lives (GitHub Pages). The phone field page is what family
// members open on their phones to join the camp.
export const SITE_URL = 'https://jappelbaum99-cmyk.github.io/hunting-app/';
export const FIELD_PAGE_URL = `${SITE_URL}field.html`;

// The hub's QR code opens the phone page with the camp code filled in
// (field.html?join=CODE). Kept here, not in lib/qr.ts, so the phone page
// doesn't load the QR library just to read it.
const JOIN_PARAM = 'join';

export function campJoinUrl(code: string): string {
  return `${FIELD_PAGE_URL}?${JOIN_PARAM}=${encodeURIComponent(code)}`;
}

// The camp code in something a QR code held: the hub's join link, or a bare
// code. Null when it isn't one of ours.
export function joinCodeFrom(text: string): string | null {
  const trimmed = text.trim();
  try {
    const code = new URL(trimmed).searchParams.get(JOIN_PARAM);
    if (code) return code;
  } catch {
    // Not a link; maybe the code itself.
  }
  return trimmed.replace(/[^A-Za-z0-9]/g, '').length === 12 ? trimmed : null;
}

// The camp code from a scanned link, if the page was opened with one. It's
// taken out of the address so a reload or a home screen icon doesn't keep it.
export function takeJoinCode(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(JOIN_PARAM);
  if (code === null) return null;
  url.searchParams.delete(JOIN_PARAM);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return code.trim() || null;
}
