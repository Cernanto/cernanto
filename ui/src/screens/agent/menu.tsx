// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useNavigate } from '@tanstack/react-router';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { PLANE_ADDRESS, plane, PlaneError, unwrap, wordsOf } from '../../api/plane.js';
import { useStanding } from '../../app/standing.js';
import { readPackageFile, useAskAgain } from '../../api/queries.js';
import {
  Button,
  ErrorLine,
  Field,
  IconButton,
  Menu,
  MenuItem,
  MenuLine,
  MenuSub,
  Sheet,
} from '../../components/ui.js';
import * as gateway from '../../gateway/sdk.gen.js';
import { idParts } from '../../model/agent.js';
import type { Fleet, FleetAgent } from '../../model/fleet.js';
import { packageOf, SOURCE, useGenerations } from '../../model/package.js';
import { isPlayground, planeWhere } from '../../model/plane.js';
import { startCompile, useCompiles, useKeptCompile } from '../../state/compiles.js';
import type { CompileKind, CompileSwitches } from '../../state/compiles.js';
import { usePlane } from '../../state/plane.js';
import { useFavorites } from '../../state/prefs.js';
import { copyText, saveFile } from '../../state/save.js';
import { gatherUploads } from '../../state/uploads.js';
import { DEPLOY_WAYS } from './source/ways.js';

/** The dialog that removes an agent. What cannot be undone is said in
 * words that name the thing and the plane it is on, and asks for the
 * thing's name wherever the reader has not said the plane is their own
 * to play with. A module's page removes the module started by itself
 * through the same dialog, and the reader stays on the module's page. */
function DeleteDialog({
  agent,
  open,
  onOpenChange,
  stay = false,
}: {
  agent: FleetAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the reader stays where they are once the agent is removed:
   * the page they are on is another agent's. */
  stay?: boolean;
}): ReactNode {
  const navigate = useNavigate();
  const askAgain = useAskAgain();
  const [standing] = usePlane();
  const careful = !isPlayground(standing);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | undefined>(undefined);
  const [dependents, setDependents] = useState<string[]>([]);
  const pressedAt = useStanding(open);

  /** Closes the window, by whatever road it is left, and forgets what
   * was typed and what the plane last said of the agent's dependents:
   * the next opening asks afresh, and forces nothing on an old word. */
  const close = (): void => {
    setTyped('');
    setTrouble(undefined);
    setDependents([]);
    onOpenChange(false);
  };

  const remove = (force: boolean): void => {
    setBusy(true);
    setTrouble(undefined);
    const still = pressedAt();
    void gateway
      .agentDelete({
        client: plane,
        path: { agentId: agent.id },
        query: force ? { force: 'true' } : {},
      })
      .then((result) => {
        unwrap(result, 'the removal');
        // The list has yet to hear that this one is gone, wherever the
        // reader stands by now.
        askAgain();
        // A reader who closed the dialog or went elsewhere while the
        // plane removed the agent stays where they are, and a dialog
        // they opened since stays as they see it: the agent's screen
        // says it is gone once the list was asked.
        if (!still()) return;
        close();
        // To the agents that are left, side by side.
        if (!stay) void navigate({ to: '/overview' });
      })
      .catch((error: unknown) => {
        // An answer to a dialog the reader left writes nothing into one
        // they opened after it: neither the dependents it lists, which
        // would offer the forced removal on an old word, nor its words.
        if (!still()) return;
        if (error instanceof PlaneError && error.dependents.length > 0) {
          setDependents(error.dependents);
        }
        setTrouble(wordsOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const where = planeWhere(standing, PLANE_ADDRESS);
  const named = !careful || typed === agent.id;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      title={`Delete ${agent.id}?`}
      description={
        agent.standaloneOf === undefined
          ? `On ${where}. A delete removes everything of an agent: its generations, its copies, its settings and its accounts. It cannot be undone.`
          : `On ${where}. This is ${agent.standaloneOf} running by itself. A delete ends it and removes what it holds: its memory and the records of the calls made there. The next call of ${agent.standaloneOf} by itself starts it again, empty. It cannot be undone.`
      }
      width={480}
    >
      <div className="flex flex-col gap-3">
        {agent.row?.package === undefined && agent.standaloneOf === undefined && (
          <p className="text-[13px] text-ink-secondary">
            If its source lives nowhere else, export it first: the agent's menu has "Export source".
          </p>
        )}
        {dependents.length > 0 && (
          <div className="rounded-md border border-bad/60 p-3 text-[13px]">
            <div className="font-semibold text-ink">Deployed agents depend on it:</div>
            <ul className="mono mt-1 text-xs text-ink-secondary">
              {dependents.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
            <p className="mt-2 text-ink-secondary">
              Removed all the same, they stay deployed and call an agent that is gone.
            </p>
          </div>
        )}
        {careful && (
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            Type the agent's id to confirm
            <Field
              autoFocus
              value={typed}
              placeholder={agent.id}
              className="mono"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </label>
        )}
        {trouble !== undefined && dependents.length === 0 && <ErrorLine>{trouble}</ErrorLine>}
        <div className="flex justify-end gap-2">
          <Button look="quiet" onClick={close}>
            Keep it
          </Button>
          <Button
            look="danger"
            disabled={busy || !named}
            onClick={() => {
              remove(dependents.length > 0);
            }}
          >
            {dependents.length > 0 ? 'Delete it all the same' : 'Delete the agent'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** The one menu of an agent's head: what acts on the agent as a whole,
 * and nothing else. */
export function AgentMenu({
  agent,
  fleet,
}: {
  agent: FleetAgent;
  fleet: Pick<Fleet, 'agents'>;
}): ReactNode {
  const navigate = useNavigate();
  const askAgain = useAskAgain();
  const generations = useGenerations(agent.id);
  const [favorites, toggleFavorite] = useFavorites();
  const [deleting, setDeleting] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; words: string } | undefined>(undefined);
  const digest = packageOf(agent, generations);
  const type = agent.ls.type;
  const stem = idParts(agent.id).name;
  // A module runs by itself from its first call that names no agent,
  // and its standalone agent is what a delete ends: the module's own
  // menu reaches that delete while the standalone agent stands.
  const runsAlone =
    type === 'module' && !agent.pair
      ? fleet.agents.find((other) => other.standaloneOf === agent.id)
      : undefined;
  const [endingAlone, setEndingAlone] = useState(false);
  // A module started by itself is an agent with no source and no program
  // of its own: its module is the one that is deployed.
  const alone = agent.standaloneOf !== undefined;

  const act = (work: () => Promise<string | undefined>): void => {
    setSaid(undefined);
    void work()
      .then((words) => {
        if (words !== undefined) setSaid({ ok: true, words });
      })
      .catch((error: unknown) => {
        setSaid({ ok: false, words: wordsOf(error) });
      });
  };
  // A compile of the agent that still runs: a second one waits for its end.
  const kept = useKeptCompile(agent.id);
  const run = useCompiles().get(agent.id);
  const compiling = kept || (run !== undefined && run.endedAt === undefined);
  /** Deploys the source the agent runs, and shows the compile where a source's compile is read. */
  const deployAgain = (kind: CompileKind, switches: CompileSwitches): void => {
    act(async () => {
      if (digest === undefined) return undefined;
      const text = await readPackageFile(digest, SOURCE);
      startCompile({
        agentId: agent.id,
        text,
        base: digest,
        kind,
        switches,
        // The files the source names go up with it, read back from the package that carries them.
        uploads: () => gatherUploads({ agentId: agent.id, text, waiting: [], base: digest }),
      });
      void navigate({ to: '/agents/$', params: { _splat: agent.id }, search: { tab: 'source' } });
      return undefined;
    });
  };

  return (
    <>
      <Menu
        trigger={
          <IconButton label="The agent's menu">
            <Ellipsis size={16} />
          </IconButton>
        }
      >
        <MenuItem
          onSelect={() => {
            toggleFavorite(agent.id);
          }}
        >
          {favorites.includes(agent.id) ? 'Remove from Favorites' : 'Add to Favorites'}
        </MenuItem>
        {(type === 'service' || type === 'worker' || type === 'job') && !alone && (
          <MenuItem
            hint={
              type === 'worker'
                ? 'A new version of the same code runs it from the top'
                : 'The same code from the top, with an empty memory'
            }
            onSelect={() => {
              act(async () => {
                const answer = unwrap(
                  await gateway.agentStart({ client: plane, path: { agentId: agent.id } }),
                  'the start',
                );
                askAgain();
                return answer.run === undefined
                  ? `${agent.id} is starting again.`
                  : `Run ${String(answer.run)} of ${agent.id} is starting.`;
              });
            }}
          >
            {/* A worker's start is named as the button at its conversation's
                foot names it; a service's and a job's by the cli's verb. */}
            {type === 'worker' ? 'Run' : 'Restart'}
          </MenuItem>
        )}
        {/* The source an agent runs is deployed again from here: the line
            under its source deploys a change, and stands there with one.
            An installed package is the registry's to land again; deployed
            from its source it would stop being that. A module started by
            itself has no source of its own: its module is what is deployed. */}
        {agent.row?.package === undefined && !alone && (
          <MenuSub
            word="Deploy again"
            hint="The source it runs, with nothing changed"
            disabled={digest === undefined || compiling}
          >
            <MenuItem
              hint="Its tests run where they have not passed"
              onSelect={() => {
                deployAgain('deploy', {});
              }}
            >
              As it is
            </MenuItem>
            {DEPLOY_WAYS.map((way) => (
              <MenuItem
                key={way.word}
                hint={way.hint}
                onSelect={() => {
                  deployAgain(way.kind, way.switches);
                }}
              >
                {way.word}
              </MenuItem>
            ))}
          </MenuSub>
        )}
        <MenuLine />
        <MenuItem
          hint={<span className="mono text-[11px]">cernanto trace {agent.id} -f</span>}
          onSelect={() => {
            void copyText(`cernanto trace ${agent.id} -f`);
          }}
        >
          Copy the cli's line
        </MenuItem>
        {/* A module started by itself has neither a source nor a package
            of its own to hand out: its module's page exports both, under
            the module's name. */}
        {!alone && (
          <>
            <MenuItem
              hint={`${stem}.cern.md, for git and for an editor`}
              disabled={digest === undefined}
              onSelect={() => {
                act(async () => {
                  if (digest === undefined) return undefined;
                  saveFile(
                    `${stem}.cern.md`,
                    await readPackageFile(digest, SOURCE),
                    'text/markdown',
                  );
                  return undefined;
                });
              }}
            >
              Export source
            </MenuItem>
            <MenuItem
              hint={`${stem}.cern, the file to send to someone`}
              disabled={digest === undefined}
              onSelect={() => {
                act(async () => {
                  if (digest === undefined) return undefined;
                  const result = await gateway.packageGet({
                    client: plane,
                    path: { digest },
                    parseAs: 'blob',
                  });
                  saveFile(
                    `${stem}.cern`,
                    unwrap(result, 'the package'),
                    'application/octet-stream',
                  );
                  return undefined;
                });
              }}
            >
              Export package
            </MenuItem>
          </>
        )}
        <MenuLine />
        {/* The module running by itself is ended by its delete, the cli's
            own word for it, from the module's page too. */}
        {runsAlone !== undefined && (
          <MenuItem
            danger
            hint="The module running by itself: its memory and its calls' records"
            onSelect={() => {
              setEndingAlone(true);
            }}
          >
            Delete {runsAlone.id}…
          </MenuItem>
        )}
        <MenuItem
          danger
          onSelect={() => {
            setDeleting(true);
          }}
        >
          Delete the agent…
        </MenuItem>
      </Menu>
      <DeleteDialog agent={agent} open={deleting} onOpenChange={setDeleting} />
      {runsAlone !== undefined && (
        <DeleteDialog agent={runsAlone} open={endingAlone} onOpenChange={setEndingAlone} stay />
      )}
      {said !== undefined && (
        <Sheet
          open
          onOpenChange={() => {
            setSaid(undefined);
          }}
          title={said.ok ? 'Done' : 'That did not work'}
          width={420}
        >
          {said.ok ? (
            <p className="text-[13px] text-ink-secondary">{said.words}</p>
          ) : (
            <ErrorLine>{said.words}</ErrorLine>
          )}
        </Sheet>
      )}
    </>
  );
}
