// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// Sets the look before anything is drawn: it follows the system unless
// the reader chose the other one, and the choice is kept under `theme`.
// A file of its own, loaded first, since the document's policy lets no
// script be written inline.
(function () {
  var root = document.documentElement;
  var chosen = null;
  try {
    chosen = localStorage.getItem('theme');
  } catch (error) {
    // The browser keeps no storage for this page: the system's look stands.
  }
  if (chosen === 'dark' || chosen === 'light') root.dataset.theme = chosen;
})();
