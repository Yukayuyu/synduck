import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './CanvasHost';
import { SessionGate } from './SessionGate';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </React.StrictMode>,
);
