// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AgentScreen } from '../screens/agent/screen.js';
import { AgentsLayout } from '../screens/agents/layout.js';
import { NoAgent } from '../screens/agents/start.js';
import { Overview } from '../screens/overview.js';
import { Settings } from '../screens/settings.js';
import { agentSearch, agentsSearch } from './search.js';
import { Shell } from './shell.js';

// Every agent, call, tab and screen has an address, and all of it
// stands after the `#`, which a browser keeps to itself and sends to
// no server: the gateway answers one document, at `/`.

const rootRoute = createRootRoute({ component: Shell });

/** The UI opens on its agents: the address of nothing leads to them. */
function Start(): ReactNode {
  return <Navigate to="/agents" replace />;
}

const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Start,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'agents',
  component: AgentsLayout,
  validateSearch: agentsSearch,
});

const noAgentRoute = createRoute({
  getParentRoute: () => agentsRoute,
  path: '/',
  component: NoAgent,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'overview',
  component: Overview,
  validateSearch: agentsSearch,
});

const agentRoute = createRoute({
  getParentRoute: () => agentsRoute,
  path: '$',
  component: AgentScreen,
  validateSearch: agentSearch,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  startRoute,
  agentsRoute.addChildren([noAgentRoute, agentRoute]),
  overviewRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
