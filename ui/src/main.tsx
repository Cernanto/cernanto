// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient } from './api/queries.js';
import { router } from './app/router.js';
import './styles/app.css';

const root = document.getElementById('root');
if (root !== null) {
  if (window.top !== window.self) {
    // No other site frames the UI: on the machine itself a request needs
    // no token, so a page that framed it could borrow the reader's clicks.
    root.textContent = 'The Cernanto UI does not open inside another page.';
  } else {
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  }
}
