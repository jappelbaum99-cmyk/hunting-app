import './wordmark.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { HubDataProvider } from '@/data/HubDataProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubDataProvider>
      <App />
    </HubDataProvider>
  </StrictMode>,
);
