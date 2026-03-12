import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import './index.css';
import { router } from './router';
import { Toaster } from './components/ui/sonner';
import { getInitialThemeMode, persistThemeMode } from './lib/theme';

if (typeof document !== 'undefined') {
  persistThemeMode(getInitialThemeMode());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </React.StrictMode>
);
