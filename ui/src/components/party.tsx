// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { File as FileIcon, Package, Server, User } from 'lucide-react';
import type { ReactNode } from 'react';

import mcpMark from '../assets/marks/mcp.svg?raw';
import npmMark from '../assets/marks/npm.svg?raw';
import openapiMark from '../assets/marks/openapi.svg?raw';
import { GATEWAY, PLANE } from '../model/conversation.js';
import type { Dot } from '../model/agent.js';
import { Avatar, ToneName } from './ui.js';

/** The kinds of thing that stand beside an agent and are none: a
 * server reached by MCP, a service reached by OpenAPI, an npm package,
 * a file, the operator who sent a call, the plane itself, and the
 * registry, where an agent stands as a package before a plane runs it. */
export type PartyKind =
  'agent' | 'mcp' | 'openapi' | 'npm' | 'file' | 'operator' | 'plane' | 'registry';

/** The kind a party's id says it is. */
export function partyKind(id: string): PartyKind {
  if (id === GATEWAY) return 'operator';
  if (id === PLANE) return 'plane';
  if (id.startsWith('mcp/') || id.startsWith('mcp:')) return 'mcp';
  if (id.startsWith('openapi/') || id.startsWith('openapi:')) return 'openapi';
  if (id.startsWith('npm:')) return 'npm';
  if (id.startsWith('file:')) return 'file';
  return 'agent';
}

const MARKS: Record<'mcp' | 'openapi' | 'npm', string> = {
  mcp: mcpMark,
  openapi: openapiMark,
  npm: npmMark,
};

/** How much of the box of an agent's picture each mark takes, so that
 * the eye takes the five for one size beside a circle: a whole square
 * reads larger than a round drawing of the same box, and a drawing
 * with margins of its own reads smaller. */
const FIT: Record<'registry' | 'npm' | 'mcp' | 'openapi' | 'file', number> = {
  registry: 1,
  npm: 0.84,
  mcp: 1.08,
  openapi: 0.96,
  file: 1,
};

/** The picture of a party that is no agent, of the size of an agent's
 * picture beside it, in the ink's colour. An operator and the plane are
 * a drawing on a round plate of the neutral tone, as a face is. The
 * registry, an npm package, an MCP server, an OpenAPI service and a
 * file are each their own mark, whole and on no plate. */
export function KindMark({
  kind,
  size = 28,
}: {
  kind: Exclude<PartyKind, 'agent'>;
  size?: number;
}): ReactNode {
  if (kind === 'operator' || kind === 'plane') {
    const inner = Math.round(size * 0.55);
    return (
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-chosen text-ink"
        style={{ width: size, height: size }}
      >
        {kind === 'operator' ? <User size={inner} /> : <Server size={inner} />}
      </span>
    );
  }
  const inner = Math.round(size * FIT[kind]);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center text-ink"
      style={{ width: size, height: size }}
    >
      {kind === 'registry' ? (
        <Package size={inner} strokeWidth={1.75} />
      ) : kind === 'file' ? (
        <FileIcon size={inner} strokeWidth={1.75} />
      ) : (
        <span
          className="inline-flex shrink-0 [&>svg]:size-full"
          style={{ width: inner, height: inner }}
          dangerouslySetInnerHTML={{ __html: MARKS[kind] }}
        />
      )}
    </span>
  );
}

/** The picture of whoever speaks in a conversation: an agent's own two
 * letters, or its kind's mark for a party that is no agent. */
export function PartyPicture({
  id,
  size = 28,
  dot,
  status,
  ground,
}: {
  id: string;
  size?: number;
  dot?: Dot | undefined;
  status?: string | undefined;
  ground?: string;
}): ReactNode {
  const kind = partyKind(id);
  if (kind !== 'agent') return <KindMark kind={kind} size={size} />;
  return (
    <Avatar
      agentId={id}
      size={size}
      dot={dot}
      status={status}
      {...(ground === undefined ? {} : { ground })}
    />
  );
}

/** A party's name as a conversation writes it: an agent by its id, in
 * its hue's tone, and an operator or the plane in a word. */
export function PartyName({ id, own = false }: { id: string; own?: boolean }): ReactNode {
  if (own) return <span className="font-semibold text-ink">You</span>;
  if (id === GATEWAY) return <span className="font-semibold text-ink">An operator</span>;
  if (id === PLANE) return <span className="font-semibold text-ink">The plane</span>;
  return <ToneName agentId={id} />;
}

/** A party's name as plain words, for a line and a saved file. */
export function partyWord(id: string, own = false): string {
  if (own) return 'you';
  if (id === PLANE) return 'the plane';
  return id === GATEWAY ? 'an operator' : id;
}
