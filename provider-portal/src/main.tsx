import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/config';
import ProviderPortal from './ProviderPortal';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ProviderPortal /></React.StrictMode>
);
