// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import type { Command } from 'commander';

import { fail } from './output.js';

// Shell completion from the command tree itself: every command and
// option the cli knows, so the script stays in step with the verbs.
// `eval "$(cernanto completion zsh)"` in the shell's rc file.

interface Tree {
  name: string;
  options: string[];
  commands: Tree[];
}

/** The command tree as data. */
export function commandTree(command: Command): Tree {
  return {
    name: command.name(),
    options: command.options.flatMap((option) =>
      [option.long, option.short].filter((flag): flag is string => typeof flag === 'string'),
    ),
    commands: command.commands.map((child) => commandTree(child)),
  };
}

function zshFunction(tree: Tree, path: string[]): string[] {
  const name = ['_cernanto', ...path].join('_');
  const lines = [`${name}() {`, '  local -a subcommands'];
  if (tree.commands.length > 0) {
    lines.push('  subcommands=(');
    for (const child of tree.commands) lines.push(`    '${child.name}'`);
    lines.push('  )');
  }
  lines.push('  if (( CURRENT == 2 )); then');
  lines.push(`    _arguments ${tree.options.map((flag) => `'${flag}'`).join(' ')} '1: :->cmds'`);
  lines.push('    _describe "command" subcommands');
  lines.push('    return');
  lines.push('  fi');
  lines.push('  case "${words[2]}" in');
  for (const child of tree.commands) {
    lines.push(
      `    ${child.name}) shift words; (( CURRENT-- )); ${[name, child.name].join('_')} ;;`,
    );
  }
  lines.push('  esac');
  lines.push('}');
  for (const child of tree.commands) lines.push(...zshFunction(child, [...path, child.name]));
  return lines;
}

function bashWords(tree: Tree, path: string[], root: string): string[] {
  const key = [root, ...path].join(' ');
  const words = [...tree.commands.map((child) => child.name), ...tree.options].join(' ');
  const lines = [`    "${key}") words="${words}" ;;`];
  for (const child of tree.commands) {
    lines.push(...bashWords(child, [...path, child.name], root));
  }
  return lines;
}

/** The completion script for zsh or bash. */
export function completionScript(command: Command, shell: string): string {
  const tree = commandTree(command);
  if (shell === 'zsh') {
    return ['#compdef cernanto', ...zshFunction(tree, []), 'compdef _cernanto cernanto', ''].join(
      '\n',
    );
  }
  if (shell === 'bash') {
    return [
      '_cernanto() {',
      '  local cur words',
      '  cur="${COMP_WORDS[COMP_CWORD]}"',
      '  local key="cernanto"',
      '  local i',
      '  for ((i = 1; i < COMP_CWORD; i++)); do',
      '    case "${COMP_WORDS[i]}" in -*) ;; *) key="$key ${COMP_WORDS[i]}" ;; esac',
      '  done',
      '  case "$key" in',
      ...bashWords(tree, [], tree.name),
      '    *) words="" ;;',
      '  esac',
      '  COMPREPLY=( $(compgen -W "$words" -- "$cur") )',
      '}',
      'complete -F _cernanto cernanto',
      '',
    ].join('\n');
  }
  throw new Error(`completion takes zsh or bash, not "${shell}"`);
}

export function registerCompletion(program: Command): void {
  program
    .command('completion')
    .argument('<shell>', 'zsh or bash')
    .description('a completion script for your shell: eval "$(cernanto completion zsh)"')
    .action((shell: string) => {
      try {
        process.stdout.write(completionScript(program, shell));
      } catch (error) {
        fail(error);
      }
    });
}
