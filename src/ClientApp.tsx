'use client';

import { useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

const subscribe = () => () => {};

// BrowserRouter needs `document`; the SPA renders only in the browser.
export default function ClientApp() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? <BrowserRouter><App /></BrowserRouter> : <div className="splash" aria-busy="true" />;
}
