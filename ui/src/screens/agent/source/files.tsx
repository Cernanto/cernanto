// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { useQuery } from '@tanstack/react-query';
import { Download, File as FileSign, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { readPackageBytes } from '../../../api/queries.js';
import { Code, languageOfFile } from '../../../components/code.js';
import { Button, cx, ErrorLine, Field, Quiet, Sheet } from '../../../components/ui.js';
import { fileStandings, lookOf, readsAsText } from '../../../model/files.js';
import type { FileStanding, StandingFile, WaitingFile } from '../../../model/files.js';
import { usePackage, weightWord } from '../../../model/package.js';
import { readBytes } from '../../../state/files.js';
import { saveFile } from '../../../state/save.js';

// THE FILES OF A SOURCE ON THE SCREEN. A line that names a file is a
// chip like any entry, and the chip opens the file: its text to read, a
// picture as a picture, and every file to download. A file is added by
// choosing it on the computer, or by dropping it on a label's row; it
// then waits in the browser and goes up with the next deploy. The file
// an agent already carries is read back from its package.

/** A file as it was chosen: the file, and its path under the folder it
 * was chosen in, empty for a file chosen by itself. */
export interface Chosen {
  rel: string;
  file: File;
}

/** What one choosing gave: files chosen by themselves, or a folder with the files under it. */
export interface Picked {
  folder: string | undefined;
  files: Chosen[];
}

/** A text longer than this is not laid out to be read: it is downloaded. */
const MOST_SHOWN = 1024 * 1024;

/** What a folder holds that no source grants: the cli leaves the same out of a folder. */
const left = (name: string): boolean => name.startsWith('.') || name === 'node_modules';

/** What an input gave: a folder chosen whole says each file's path from its own name. */
function pickedOf(list: FileList): Picked {
  const all = [...list];
  const first = all[0]?.webkitRelativePath ?? '';
  if (first === '') return { folder: undefined, files: all.map((file) => ({ rel: '', file })) };
  const folder = first.split('/')[0] ?? '';
  return {
    folder,
    files: all
      .map((file) => ({ rel: file.webkitRelativePath.split('/').slice(1).join('/'), file }))
      .filter((one) => one.rel !== '' && !one.rel.split('/').some(left)),
  };
}

/** A dropped folder, read whole. */
async function folderOf(entry: FileSystemDirectoryEntry, under = ''): Promise<Chosen[]> {
  const reader = entry.createReader();
  const out: Chosen[] = [];
  for (;;) {
    // A reader hands a folder's entries a few at a time, and none when it is through.
    const some = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (some.length === 0) break;
    for (const one of some) {
      if (left(one.name)) continue;
      const rel = under === '' ? one.name : `${under}/${one.name}`;
      if (one.isDirectory) out.push(...(await folderOf(one as FileSystemDirectoryEntry, rel)));
      else if (one.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (one as FileSystemFileEntry).file(resolve, reject);
        });
        out.push({ rel, file });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * What was dropped: the files dropped by themselves as one choosing,
 * and each dropped folder as one of its own. The entries are asked of
 * the drop at once: a browser lets go of them when the drop's own
 * moment is over.
 */
export function pickedOfDrop(transfer: DataTransfer): Promise<Picked[]> {
  const entries = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }));
  return (async () => {
    const loose: Chosen[] = [];
    const out: Picked[] = [];
    for (const { entry, file } of entries) {
      if (entry?.isDirectory === true) {
        out.push({ folder: entry.name, files: await folderOf(entry as FileSystemDirectoryEntry) });
      } else if (file !== null) loose.push({ rel: '', file });
    }
    return loose.length > 0 ? [{ folder: undefined, files: loose }, ...out] : out;
  })();
}

/** Whether what is dragged over the page is files. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes('Files');
}

/**
 * The two presses that choose files on the computer: files, or a folder
 * whole. A label that takes one document offers the one press for it.
 */
export function ChooseFiles({
  onPicked,
  takesDocument = false,
}: {
  onPicked: (picked: Picked) => void;
  /** The label takes one document, and no folder. */
  takesDocument?: boolean;
}): ReactNode {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement): void => {
    if (input.files !== null && input.files.length > 0) onPicked(pickedOf(input.files));
    // The same file chosen again is a choosing again.
    input.value = '';
  };
  // A press leaves the keyboard in the field the presses stand under.
  const kept = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pt-2 pb-1">
      <Button
        small
        onMouseDown={kept}
        onClick={() => {
          files.current?.click();
        }}
      >
        <FileSign size={13} /> {takesDocument ? 'Choose a document' : 'Choose files'}
      </Button>
      {!takesDocument && (
        <Button
          small
          onMouseDown={kept}
          onClick={() => {
            folder.current?.click();
          }}
        >
          <FolderOpen size={13} /> Choose a folder
        </Button>
      )}
      <span className="text-xs text-ink-muted">
        or drop {takesDocument ? 'it' : 'them'} on the row
      </span>
      <input
        ref={files}
        type="file"
        hidden
        multiple={!takesDocument}
        {...(takesDocument ? { accept: '.yaml,.yml,.json' } : {})}
        aria-label={takesDocument ? 'Choose a document' : 'Choose files'}
        onChange={(event) => {
          take(event.target);
        }}
      />
      <input
        ref={folder}
        type="file"
        hidden
        aria-label="Choose a folder"
        // A folder is chosen whole by an attribute every browser spells this way.
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          take(event.target);
        }}
      />
    </div>
  );
}

/** How every line of a source that names files stands, read again as the source and its files change. */
export function useFileStandings(
  text: string,
  agentId: string,
  waiting: readonly WaitingFile[],
  digest: string | undefined,
): FileStanding[] {
  const record = usePackage(digest).manifest?.record;
  return useMemo(
    () => fileStandings(text, agentId, waiting, record),
    [text, agentId, waiting, record],
  );
}

/** The keys, among a draft's waiting files, whose bytes this browser no
 * longer keeps: its data was cleared, or the draft came from a window
 * that held them alone. */
export function useLostFiles(waiting: readonly WaitingFile[]): ReadonlySet<string> {
  const keys = waiting.map((file) => file.key);
  const lost = useQuery({
    queryKey: ['waiting-bytes', keys.join(',')],
    queryFn: async () => {
      const gone: string[] = [];
      for (const key of keys) if ((await readBytes(key)) === undefined) gone.push(key);
      return gone;
    },
    enabled: keys.length > 0,
    staleTime: Infinity,
  });
  return useMemo(() => new Set(lost.data ?? []), [lost.data]);
}

/** A file's bytes, and its text where it is one to read. */
interface Read {
  bytes: Blob;
  text: string | undefined;
}

/** Reads a line's file: one that waits from the browser, one the package carries from the plane. */
function useFile(
  file: StandingFile | undefined,
  digest: string | undefined,
): { data: Read | undefined; isPending: boolean; error: Error | null } {
  const from = file?.from;
  return useQuery({
    queryKey: [
      'file-bytes',
      from === undefined
        ? ''
        : 'waiting' in from
          ? from.waiting
          : `${digest ?? ''}/${from.carried}`,
    ],
    queryFn: async (): Promise<Read> => {
      if (file === undefined || from === undefined) throw new Error('No file is chosen.');
      const bytes =
        'waiting' in from
          ? await readBytes(from.waiting)
          : digest === undefined
            ? undefined
            : await readPackageBytes(digest, from.carried);
      if (bytes === undefined) throw new Error('This browser no longer keeps the file.');
      const shown =
        lookOf(file.name) === 'text' &&
        bytes.size <= MOST_SHOWN &&
        readsAsText(new Uint8Array(await bytes.slice(0, 8192).arrayBuffer()));
      return { bytes, text: shown ? await bytes.text() : undefined };
    },
    enabled: file !== undefined,
    staleTime: Infinity,
    retry: false,
  });
}

/** A picture, shown from its bytes for as long as it is looked at. */
function Picture({ bytes, name }: { bytes: Blob; name: string }): ReactNode {
  const [address, setAddress] = useState<string | undefined>(undefined);
  useEffect(() => {
    const made = URL.createObjectURL(bytes);
    setAddress(made);
    return () => {
      URL.revokeObjectURL(made);
    };
  }, [bytes]);
  if (address === undefined) return null;
  return (
    <div className="flex max-h-[56vh] items-center justify-center overflow-auto bg-sunken p-4">
      <img src={address} alt={name} className="max-w-full" />
    </div>
  );
}

/** How a line stands, in words. */
function standingWords(line: FileStanding): string {
  const many = line.files.length > 1 ? `${String(line.files.length)} files. ` : '';
  if (line.standing === 'carried') return `${many}In the package the agent runs.`;
  if (line.standing === 'waiting') {
    return `${many}Chosen in this browser: ${line.files.length > 1 ? 'they go' : 'it goes'} to the plane with the next deploy.`;
  }
  if (line.standing === 'outside')
    return 'This path leaves the workspace: no file can stand there.';
  return 'No file is behind this entry yet. Choose its file, or remove the entry.';
}

/**
 * A line's file, opened: read where it is text, seen where it is a
 * picture, and downloaded whatever it is. Where the source may be
 * changed, the file is replaced by another chosen on the computer, its
 * path is given another, and the entry is removed, from here.
 *
 * @param line - The line that is open; none while the sheet is closed.
 * @param digest - The package the agent's own files are read from.
 * @param onReplace - Takes other files for the line; absent where the source is read alone.
 * @param onMove - Gives the line another path, and answers in words why it could not.
 */
export function FileSheet({
  line,
  digest,
  onClose,
  onReplace,
  onRemove,
  onMove,
}: {
  line: FileStanding | undefined;
  digest: string | undefined;
  onClose: () => void;
  onReplace?: (picked: Picked) => void;
  onRemove?: () => void;
  onMove?: (written: string) => string | undefined;
}): ReactNode {
  const [at, setAt] = useState(0);
  const [path, setPath] = useState('');
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const again = useRef<HTMLInputElement>(null);
  const entry = line?.named.entry;
  const written = line?.named.written ?? '';
  // Another line opened: its own first file, its own path.
  const [stood, setStood] = useState(entry);
  if (entry !== stood) {
    setStood(entry);
    setAt(0);
    setPath(written);
    setRefused(undefined);
  }
  const file = line?.files[Math.min(at, Math.max(0, (line.files.length || 1) - 1))];
  const read = useFile(file, digest);
  // A line that names a folder is chosen again as a folder.
  const whole = written.endsWith('/') || (line?.files.some((one) => one.rel !== '') ?? false);
  const move = (): void => {
    if (onMove === undefined || path === written) return;
    setRefused(onMove(path.trim()));
  };

  return (
    <Sheet
      open={line !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={<span className="mono text-[13px]">{written}</span>}
      description={line === undefined ? undefined : standingWords(line)}
      width={860}
      // A file is opened to be read: a key pressed changes no path.
      keyboard="sheet"
    >
      {line !== undefined && (
        <div className="flex flex-col gap-3">
          {line.files.length > 1 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border">
              {line.files.map((one, index) => (
                <li key={one.place}>
                  <button
                    type="button"
                    aria-current={index === at}
                    onClick={() => {
                      setAt(index);
                    }}
                    className={cx(
                      'flex w-full items-center gap-2 px-3 py-1 text-left text-xs',
                      index === at ? 'bg-chosen text-ink' : 'text-ink-secondary hover:bg-hover',
                    )}
                  >
                    <span className="mono min-w-0 flex-1 truncate">{one.rel}</span>
                    <span className="figures shrink-0 text-ink-muted">{weightWord(one.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {file !== undefined && (
            <div className="overflow-hidden rounded-md border">
              <div className="flex h-9 items-center gap-2 border-b bg-sunken pr-1.5 pl-3 text-xs text-ink-muted">
                <span className="mono min-w-0 flex-1 truncate text-ink-secondary">
                  {file.rel === '' ? file.name : file.rel}
                </span>
                <span className="figures">{weightWord(file.size)}</span>
                <Button
                  look="quiet"
                  small
                  disabled={read.data === undefined}
                  onClick={() => {
                    if (read.data === undefined) return;
                    const { bytes } = read.data;
                    saveFile(
                      file.name,
                      bytes,
                      bytes.type === '' ? 'application/octet-stream' : bytes.type,
                    );
                  }}
                >
                  <Download size={13} /> Download
                </Button>
              </div>
              {read.isPending ? (
                <Quiet>Reading the file…</Quiet>
              ) : read.error !== null ? (
                <Quiet>{read.error.message}</Quiet>
              ) : read.data?.text !== undefined ? (
                <div className="h-[min(56vh,520px)]">
                  <Code
                    key={file.place}
                    text={read.data.text}
                    language={languageOfFile(file.name)}
                    wrap
                    label={file.name}
                  />
                </div>
              ) : read.data !== undefined && lookOf(file.name) === 'picture' ? (
                <Picture bytes={read.data.bytes} name={file.name} />
              ) : (
                <Quiet>
                  {file.size > MOST_SHOWN && lookOf(file.name) === 'text'
                    ? 'This file is too long to lay out here. Download it to read it.'
                    : 'This kind of file is not shown here. Download it to open it.'}
                </Quiet>
              )}
            </div>
          )}
          {/* What changes the line stands together under what shows it: its
              path, the entry's removal, and another file in its place. */}
          {refused !== undefined && <ErrorLine>{refused}</ErrorLine>}
          {(onMove !== undefined || onReplace !== undefined || onRemove !== undefined) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onMove !== undefined && (
                <label className="flex min-w-56 flex-1 items-center gap-3 text-[13px] text-ink">
                  Path
                  <Field
                    value={path}
                    aria-label="The file's path in the workspace"
                    className="mono"
                    spellCheck={false}
                    onChange={(event) => {
                      setPath(event.target.value);
                      setRefused(undefined);
                    }}
                    onBlur={move}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') move();
                    }}
                  />
                </label>
              )}
              {onRemove !== undefined && (
                <Button look="quiet" small onClick={onRemove}>
                  <Trash2 size={13} /> Remove the entry
                </Button>
              )}
              {onReplace !== undefined && line.standing !== 'outside' && (
                <>
                  <Button
                    small
                    onClick={() => {
                      again.current?.click();
                    }}
                  >
                    <Upload size={13} />{' '}
                    {line.standing === 'missing'
                      ? whole
                        ? 'Choose its folder'
                        : 'Choose its file'
                      : whole
                        ? 'Replace the folder'
                        : 'Replace the file'}
                  </Button>
                  <input
                    ref={again}
                    type="file"
                    hidden
                    aria-label={
                      whole ? 'Choose the folder for this entry' : 'Choose the file for this entry'
                    }
                    {...(whole ? { webkitdirectory: '' } : {})}
                    onChange={(event) => {
                      const list = event.target.files;
                      if (list !== null && list.length > 0) onReplace(pickedOf(list));
                      event.target.value = '';
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
