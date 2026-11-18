// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The service program: a service agent runs as one program call
// per generation; its exported functions stay on the wire as thin
// fronts that hand each incoming call to the program, which serves them
// side by side and keeps the agent's memory in the process's own module
// scope. The names the serve machinery composes.

/** The handler name the program owns on every service; a coder's
 * exported function may not take it. */
export const PROGRAM_HANDLER = 'run';

// The runtime's own functions on an agent, which the platform asks by
// name: the seam says them.
export { END_LIFE_HANDLER, HAND_ON_HANDLER, LIFE_HANDLER } from '../kernel/seam.js';
