// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

/** Hands the browser a file to save, made here from what the plane answered. */
export function saveFile(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Copies a text. A plane is reached on plain http inside a private
 * network too, where a browser withholds its clipboard, so the older
 * way stands where the newer is absent.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // A browser gives its clipboard to a secure page alone, whatever the types say.
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (clipboard !== undefined && window.isSecureContext) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // The newer way was refused: the older one follows.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    // The older way is the only one a page that is not secure has.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}
