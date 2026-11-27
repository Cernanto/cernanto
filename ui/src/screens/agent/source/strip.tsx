// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { Download, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../../components/ui.js';
import { ViewSwitch } from '../../../components/view-switch.js';
import { idParts } from '../../../model/agent.js';
import type { FileView } from '../../../model/view.js';
import { copyText, saveFile } from '../../../state/save.js';
import { CopyButton } from '../trace/body.js';

/** The words of a source that came from the registry: where from, at
 * what version and by whom. They say nothing of whether it was changed
 * here, so a first change moves nothing in the strip. */
export function InstalledWords({
  installed,
}: {
  installed: { version?: string | undefined; publisher?: string | undefined };
}): ReactNode {
  return (
    <>
      <span className="font-semibold text-ink">Installed from the registry</span>
      {installed.version !== undefined && ` · ${installed.version}`}
      {installed.publisher !== undefined && ` · published by ${installed.publisher}`}
    </>
  );
}

/** The cli's line that deploys an agent from a workspace, to copy. */
export function DeployLine({ agentId }: { agentId: string }): ReactNode {
  const line = `cernanto deploy ${agentId}`;
  return (
    <Button
      look="quiet"
      small
      onClick={() => {
        void copyText(line);
      }}
      title={line}
    >
      <Terminal size={13} /> Copy deploy command
    </Button>
  );
}

/**
 * The strip over a source, one strip wherever a source is shown, so
 * that every control is found where it was. How the source is shown
 * stands first; then where the source comes from, and the file's name;
 * and at the end what takes the text away, a copy and a file. What one
 * page offers alone stands before those two, so nothing the pages share
 * moves when it comes or goes. The file's name gives way first where
 * the strip is short of room, then the words, and the controls go under
 * them as one only after that.
 */
export function SourceStrip({
  agentId,
  view,
  onView,
  text,
  actions,
  children,
}: {
  agentId: string;
  view: FileView;
  onView: (view: FileView) => void;
  /** The text shown, to copy and to save; none while it is not read. */
  text: string | undefined;
  /** What this strip offers that the other does not. */
  actions?: ReactNode;
  /** The words of what is shown. */
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-surface px-5 py-2 text-[13px]">
      <ViewSwitch view={view} onChoose={onView} label="How the source is shown" />
      {/* As tall as the tallest control of the strips of the tabs beside this one, so the switch they share stands at one height. */}
      <div className="flex min-h-8 min-w-0 flex-[1_1_14rem] items-center gap-x-3">
        <span className="min-w-0 text-ink-secondary">{children}</span>
        <span className="mono min-w-0 flex-[1_1_0] truncate text-xs text-ink-muted">
          {agentId}.cern.md
        </span>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1.5">
        {actions}
        {text !== undefined && (
          <>
            <CopyButton text={text} label="Copy the source" />
            <Button
              look="quiet"
              small
              onClick={() => {
                saveFile(`${idParts(agentId).name}.cern.md`, text, 'text/markdown');
              }}
            >
              <Download size={13} /> Export source
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
