import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/i18n/config';
import ProviderPortal from './ProviderPortal';
import '../../../src/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProviderPortal />
  </React.StrictMode>
);
