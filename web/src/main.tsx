import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GenericVerify } from './pages/GenericVerify.js';
import { EventVerify } from './pages/EventVerify.js';
import './styles.css';

// The session cookie (set by mac-auth on the callback) is exchanged for a JWT
// lazily via the API client's ensureToken() — no token handoff to capture here.

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GenericVerify />} />
        <Route path="/e/:slug" element={<EventVerify />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
