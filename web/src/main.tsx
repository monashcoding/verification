import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { captureTokenFromRedirect } from './auth.js';
import { GenericVerify } from './pages/GenericVerify.js';
import { EventVerify } from './pages/EventVerify.js';
import './styles.css';

// Grab a token handed back by mac-auth before anything renders.
captureTokenFromRedirect();

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
