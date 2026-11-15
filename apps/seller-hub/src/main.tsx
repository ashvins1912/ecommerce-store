import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../src/App';
import { LanguageProvider } from '../../../src/lib/i18n';
import '../../../src/index.css';

if (window.location.pathname === '/') {
  window.history.replaceState({}, '', '/seller-hub');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
