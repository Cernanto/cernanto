// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { useCallStory } from '../../../api/queries.js';
import type { CallSummary } from '../../../gateway/types.gen.js';
import { oneLine } from '../../../model/call-story.js';
import { useSeen } from '../../../state/sight.js';
import { Running } from '../trace/message.js';

/**
 * What a call of a list was asked and what came of it, in one line, as
 * `cernanto calls` writes them: the input, an arrow, and the answer, the
 * words of its failure, or that it runs. After it, how many calls it
 * made. The two are read from the call's own records once its line
 * comes into sight; until then, and for a call whose records are no
 * longer kept, the line says how the call stands.
 */
export function CallStoryCells({ call }: { call: CallSummary }): ReactNode {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const story = useCallStory(call, seen);
  const read = story.data;
  const input = read?.input === undefined ? '' : oneLine(read.input);
  const came: ReactNode =
    call.status === 'running' ? (
      <span className="text-ink">
        Running <Running since={call.at} />
      </span>
    ) : call.status === 'error' ? (
      <span className="text-bad">
        <span className="font-semibold">Failed</span>
        {call.error !== undefined && `: ${call.error}`}
      </span>
    ) : read?.answered === true ? (
      <span className="text-ink">{read.output === undefined ? 'Done' : oneLine(read.output)}</span>
    ) : (
      'Completed'
    );
  return (
    <>
      <span ref={ref} className="flex min-w-0 flex-1 items-center gap-1.5 text-ink-muted">
        {input !== '' && (
          <>
            <span
              className="max-w-[45%] min-w-0 shrink-0 truncate text-ink-secondary"
              title={input}
            >
              {input}
            </span>
            <ArrowRight size={12} className="shrink-0" aria-label="answered" />
          </>
        )}
        <span
          className="min-w-0 truncate"
          title={
            call.status === 'error'
              ? call.error
              : call.status === 'ok' && read?.answered === true && read.output !== undefined
                ? oneLine(read.output)
                : undefined
          }
        >
          {came}
        </span>
      </span>
      {read !== undefined && read.made > 0 && (
        <span
          className="figures shrink-0 text-right text-xs text-ink-muted"
          title={`This call made ${String(read.made)} ${read.made === 1 ? 'call' : 'calls'} of its own`}
        >
          {read.made} {read.made === 1 ? 'call' : 'calls'} out
        </span>
      )}
    </>
  );
}
