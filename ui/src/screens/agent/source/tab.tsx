// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { patched, standingHere } from '../../../app/search.js';
import { wordsOf } from '../../../api/plane.js';
import { usePackageFile } from '../../../api/queries.js';
import { Code } from '../../../components/code.js';
import { Button, Quiet } from '../../../components/ui.js';
import { useFileView } from '../../../components/view-switch.js';
import type { Fleet, FleetAgent } from '../../../model/fleet.js';
import { packageOf, SOURCE, useGenerationGone, useGenerations } from '../../../model/package.js';
import { dismissCompile, useCompiles } from '../../../state/compiles.js';
import { currentDraft, useDrafts, withFiles } from '../../../state/drafts.js';
import type { Draft } from '../../../state/drafts.js';
import { GenerationGone } from '../code/generation.js';
import { CompileArea } from './compile.js';
import { SourceEditor } from './editor.js';
import { SourceParts } from './parts.js';
import { DeployLine, InstalledWords, SourceStrip } from './strip.js';

const route = getRouteApi('/agents/$');

/**
 * The Source tab: the source the agent was compiled from, byte for
 * byte, as its package holds it, on the page it is read and written
 * on. It is shown rendered, in the parts the scan splits it into, its
 * labels as what they grant and its two texts drawn, or raw, as the
 * text it is, by a switch the browser remembers.
 *
 * THE SOURCE AN AGENT RUNS IS WRITTEN WHERE IT IS READ. Nothing opens
 * an edit: the first change of a field or a text makes a draft, which
 * is the browser's alone, and the line that discards, reviews and
 * deploys it comes with it. A change taken back, or discarded, leaves
 * no draft. The plane hears of none of it before a deploy. The plane
 * says of a source that it is an installed package's, its publisher's,
 * and nothing more of where it lives: it may be a workspace's, in git,
 * or one written in a browser.
 *
 * The source of a generation the agent no longer runs is read alone:
 * it is what was, and a draft is of what the agent runs now.
 */
export function SourceTab({ agent, fleet }: { agent: FleetAgent; fleet: Fleet }): ReactNode {
  const search = route.useSearch();
  const generations = useGenerations(agent.id);
  const gone = useGenerationGone(agent.id, search.gen);
  const active = packageOf(agent, generations);
  const digest = packageOf(agent, generations, search.gen);
  const source = usePackageFile(digest, SOURCE);
  const deployed = usePackageFile(active, SOURCE);
  const { drafts, save, drop, discard, rename } = useDrafts();
  const navigate = useNavigate();
  const compiles = useCompiles();
  const [view, setView] = useFileView('source.view');
  const draft = drafts[agent.id];
  const run = compiles.get(agent.id);
  const installed = agent.row?.package;
  const file = `${agent.id}.cern.md`;
  // A draft that says what the agent runs, with no file chosen for it,
  // changes nothing and is let go: a source nobody changed carries no
  // draft, whoever opened one on it and however long ago.
  const unchanged =
    draft !== undefined &&
    deployed.data !== undefined &&
    draft.text === deployed.data &&
    (draft.files ?? []).length === 0;
  useEffect(() => {
    if (unchanged) drop(agent.id);
  }, [unchanged, agent.id, drop]);

  // A module started by itself has no source of its own. What it runs
  // is its module's, which has one home: the module's own page, where it
  // is read, changed and deployed under the module's id.
  const moduleId = agent.standaloneOf;
  if (moduleId !== undefined) {
    return (
      <Quiet>
        This agent is {moduleId} started by itself, and has no source of its own.
        <span className="mt-1 block text-xs">
          It runs the module&apos;s source, which is read and deployed on the module&apos;s page.
        </span>
        <Button
          small
          className="mt-4"
          onClick={() => {
            void navigate({
              to: '/agents/$',
              params: { _splat: moduleId },
              search: { tab: 'source' },
            });
          }}
        >
          Show the source of {moduleId}
        </Button>
      </Quiet>
    );
  }

  const showCurrent = (): void => {
    void navigate({
      to: '.',
      search: (previous) => patched(previous, { gen: undefined }),
      replace: true,
    });
  };
  if (gone && search.gen !== undefined) {
    return <GenerationGone gen={search.gen} onCurrent={showCurrent} />;
  }
  if (digest === undefined) return <Quiet>The plane names no package for this agent.</Quiet>;

  // A generation the address names that is not the one the agent runs
  // is read as it was. A draft and a deploy are of what the agent runs
  // now, and stand where no other generation is asked for. Which
  // generation that is goes by its number: two generations may run one
  // package, as after a rollout that changed no source.
  const running = generations.find((entry) => entry.status === 'active') ?? generations[0];
  const earlier = search.gen !== undefined && search.gen !== running?.gen;

  if (!earlier && active !== undefined && deployed.data !== undefined) {
    const now = { text: deployed.data, digest: active };
    // The page shows the draft the browser holds, or the source the
    // agent runs as the draft its first change would make of it.
    const shown: Draft = draft ?? {
      id: agent.id,
      text: now.text,
      base: now.digest,
      baseText: now.text,
      updatedAt: '',
    };
    return (
      <SourceEditor
        key={agent.id}
        draft={shown}
        held={draft !== undefined && !unchanged}
        deployed={now}
        installed={installed}
        fleet={fleet}
        onChange={(text, files) => {
          // The draft as the browser holds it at this moment: a change may
          // come a while after it was begun, a file's bytes kept first.
          const stands = currentDraft(agent.id);
          const waits = files ?? stands?.files ?? [];
          const updatedAt = new Date().toISOString();
          // A change taken back whole, with no file chosen, leaves nothing
          // to deploy, and no draft.
          if (text === now.text && waits.length === 0) {
            if (stands !== undefined) drop(agent.id);
            return;
          }
          if (stands !== undefined) {
            save(withFiles({ ...stands, text, updatedAt }, waits));
            return;
          }
          // The report of the deploy before it gives its room to the change.
          dismissCompile(agent.id);
          save(
            withFiles(
              { id: agent.id, text, base: now.digest, baseText: now.text, updatedAt },
              waits,
            ),
          );
        }}
        onDiscard={() => {
          discard(agent.id);
        }}
        onRebase={() => {
          if (draft !== undefined) save({ ...draft, base: now.digest, baseText: now.text });
        }}
        // A draft opened on no package was written as a new agent, before
        // this one was deployed under its id: another id keeps it one.
        {...(draft !== undefined && draft.base === undefined
          ? {
              onRename: async (to: string) => {
                const here = standingHere();
                const moved = await rename(agent.id, to);
                if ((moved === 'moved' || moved === 'copied') && here()) {
                  void navigate({ to: '/agents/$', params: { _splat: to } });
                }
                return moved;
              },
            }
          : {})}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SourceStrip
        agentId={agent.id}
        view={view}
        onView={setView}
        text={source.data}
        actions={
          earlier ? (
            <Button small onClick={showCurrent}>
              Show what the agent runs now
            </Button>
          ) : (
            installed === undefined && <DeployLine agentId={agent.id} />
          )
        }
      >
        {earlier ? (
          <>
            <span className="font-semibold text-ink">The source of generation {search.gen}</span> ·
            not what the agent runs now
          </>
        ) : (
          installed !== undefined && <InstalledWords installed={installed} />
        )}
      </SourceStrip>
      <div className="min-h-0 flex-1">
        {source.isPending ? (
          <Quiet>Reading the source…</Quiet>
        ) : source.isError ? (
          <Quiet>
            The source could not be read.
            <span className="mt-1 block text-xs">{wordsOf(source.error)}</span>
          </Quiet>
        ) : view === 'rendered' ? (
          <SourceParts text={source.data} fleet={fleet} agentId={agent.id} digest={digest} />
        ) : (
          <div className="h-full w-full">
            <Code key={digest} text={source.data} language="markdown" wrap labels label={file} />
          </div>
        )}
      </div>
      {run !== undefined && <CompileArea run={run} />}
    </div>
  );
}
