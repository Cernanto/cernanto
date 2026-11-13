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

/** The runtime's own function on every task and job: the agent's newest
 * generation takes over the calls a retired generation still held when
 * its copies died. No exported function can carry the name. */
export const HAND_ON_HANDLER = '#handOn';

/** The runtime's own function on every agent that answers the life an
 * agent's name stands under, made when none stands:
 * `{agentId, ending?}` answered `{life}`, the kernel acting since it
 * owns the record, the files and the keys. The controller asks it of
 * the host job at an agent's admission, the host job of itself at a
 * plane's birth. */
export const LIFE_HANDLER = '#life';

/** The runtime's own function on every agent that ends a life: the
 * name's record stops naming it and everything kept under it is
 * removed, `{agentId, life}` answered `{done}` (false asks again
 * later). */
export const END_LIFE_HANDLER = '#endLife';
