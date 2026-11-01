import './field.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FieldApp } from '@/field/FieldApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FieldApp />
  </StrictMode>,
);

// Cache the page so it opens in the woods with no signal (needs HTTPS or localhost).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}field-sw.js`).catch(() => undefined);
}
