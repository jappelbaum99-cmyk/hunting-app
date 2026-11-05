import '../wordmark.css';
import './field.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FieldApp } from '@/field/FieldApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FieldApp />
  </StrictMode>,
);

// Ask the browser to keep this page's saved pins and hunts even when the phone
// is low on space (Safari otherwise may clear site data it thinks is unused).
void navigator.storage?.persist?.().catch(() => false);

// Cache the page so it opens in the woods with no signal (needs HTTPS or localhost).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}field-sw.js`).catch(() => undefined);
}
