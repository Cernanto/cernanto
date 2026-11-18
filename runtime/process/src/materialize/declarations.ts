// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1

// The declared surface of a contract (`contract.d.ts`), read with the
// TypeScript parser alone: which exported functions answer a promise
// (the wire handlers a stub wraps), which are synchronous helpers
// (re-exported plainly from a linked module), and which names are
// constants. The compiler reads a contract the same way when it writes
// the coder's twins; the glue the materialize writes must agree with
// those twins name for name.

import ts from 'typescript';

import type { WireShape } from '@cernanto/runtime-lib';

export interface DeclaredFunction {
  name: string;
  /** Whether the declared return type is a Promise (or PromiseLike). */
  async: boolean;
  /** Whether the name is declared both ways, with a promise for its
   * answer and with a plain one (its overloads differ). Over the wire
   * it is a handler like any other, every answer there being a
   * promise; linked in process it can be neither a traced call, which
   * answers a promise every time, nor a helper passed straight
   * through, which runs outside the module's own call. */
  mixed?: boolean;
  /** The declared parameter names, in order (a pattern reads `arg<n>`). */
  parameters: string[];
  /** Whether the last parameter is a rest parameter (`...values`): a
   * wrapper takes it as one and hands every argument on. A function
   * declared more than once (its overloads) reads as one function:
   * with the first signature's parameters when every signature takes
   * as many, with a rest parameter alone otherwise. */
  rest?: boolean;
  /** Whether a parameter or the answer is marked `Secret<T>`: the
   * caller records neither the arguments nor the result, and the
   * callee's call runs unrecorded. */
  secret: boolean;
  /** Where the dates and the bytes lie in the function's argument and
   * answer, read from the contract's own declarations (a `Date` or a
   * `Uint8Array`, through interfaces, aliases, lists, records and
   * optional or nullable unions): the glue revives the wire's text by
   * it. Absent when neither carries one. */
  shapes?: WireShapes;
}

export interface WireShapes {
  /** The one argument's shape (a wire handler takes one). */
  argument?: WireShape;
  /** The shape of each declared parameter when the function takes
   * several (or a rest parameter, whose list is the last): the wire
   * carries them as one record keyed by their names, and each is
   * revived by its own shape before the spread. Absent when none
   * carries a date or bytes. */
  parameters?: (WireShape | undefined)[];
  /** The answer's shape, the promise unwrapped. */
  result?: WireShape;
}

export interface DeclaredSurface {
  functions: DeclaredFunction[];
  constants: string[];
}

function parameterNamesOf(parameters: readonly ts.ParameterDeclaration[]): string[] {
  return parameters.map((parameter, index) =>
    ts.isIdentifier(parameter.name) ? parameter.name.text : `arg${String(index)}`,
  );
}

/** Whether a parameter list ends in a rest parameter. */
function endsInRest(parameters: readonly ts.ParameterDeclaration[]): boolean {
  return parameters.at(-1)?.dotDotDotToken !== undefined;
}

/** One function read from two declarations of its name (its overloads):
 * a promise from either makes it a handler, a promise from one and a
 * plain answer from another mark it declared both ways, a secret in
 * either makes it one, and a shape stands where both name the same.
 * Two signatures that take as many plain parameters keep the first
 * one's names; any others are one rest parameter, each signature
 * having its own. */
function mergedOverload(first: DeclaredFunction, next: DeclaredFunction): DeclaredFunction {
  const argument = sameShape(first.shapes?.argument, next.shapes?.argument)
    ? first.shapes?.argument
    : undefined;
  const result = sameShape(first.shapes?.result, next.shapes?.result)
    ? first.shapes?.result
    : undefined;
  const alike =
    first.rest !== true && next.rest !== true && first.parameters.length === next.parameters.length;
  const mixed = first.async !== next.async || first.mixed === true || next.mixed === true;
  return {
    name: first.name,
    async: first.async || next.async,
    ...(mixed ? { mixed: true } : {}),
    ...(alike ? { parameters: first.parameters } : { parameters: ['input'], rest: true }),
    secret: first.secret || next.secret,
    ...shapesEntry(
      argument === undefined && result === undefined
        ? undefined
        : {
            ...(argument === undefined ? {} : { argument }),
            ...(result === undefined ? {} : { result }),
          },
    ),
  };
}

/** The contract's own type declarations by name: what a parameter's
 * or an answer's type may refer to. */
type DeclaredTypes = ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>;

function declaredTypesOf(source: ts.SourceFile): DeclaredTypes {
  const declared = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declared.set(statement.name.text, statement);
    }
  }
  return declared;
}

/** Whether a declared type, a parameter's or the answer's, carries the
 * os module's `Secret<T>` mark: in its own text, or in a type the
 * contract declares that it refers to, however deep (a field of an
 * interface, an interface it extends, an alias). A secret inside a
 * value is a secret value. */
function carriesSecret(
  node: ts.Node | undefined,
  declared: DeclaredTypes,
  seen: Set<string>,
): boolean {
  if (node === undefined) return false;
  if (/\bSecret\s*</.test(node.getText())) return true;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    const name = ts.isTypeReferenceNode(child)
      ? child.typeName.getText()
      : ts.isExpressionWithTypeArguments(child)
        ? child.expression.getText()
        : undefined;
    if (name !== undefined && !seen.has(name)) {
      const declaration = declared.get(name);
      if (declaration !== undefined) {
        seen.add(name);
        if (carriesSecret(declaration, declared, seen)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isSecret(
  parameters: readonly ts.ParameterDeclaration[],
  returnType: ts.TypeNode | undefined,
  declared: DeclaredTypes,
): boolean {
  const seen = new Set<string>();
  return (
    parameters.some((parameter) => carriesSecret(parameter.type, declared, seen)) ||
    carriesSecret(returnType, declared, seen)
  );
}

const UNWRAPPED = new Set([
  'Promise',
  'PromiseLike',
  'Awaited',
  'Readonly',
  'Partial',
  'Required',
  'NonNullable',
  'Pick',
  'Omit',
]);

function isNullish(node: ts.TypeNode): boolean {
  if (
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword ||
    node.kind === ts.SyntaxKind.NeverKeyword
  ) {
    return true;
  }
  return ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;
}

function sameShape(a: WireShape | undefined, b: WireShape | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Two shapes of one value (an intersection, an interface and what it
 * extends): the fields of both, or the one given, or nothing when they
 * disagree. */
function mergeShapes(a: WireShape | undefined, b: WireShape | undefined): WireShape | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof a !== 'string' && typeof b !== 'string' && 'fields' in a && 'fields' in b) {
    return { fields: { ...a.fields, ...b.fields } };
  }
  return sameShape(a, b) ? a : undefined;
}

/** What a declaration's type parameters stand for where it is referred
 * to: the shape of the argument given in each one's place, by the
 * parameter's name. */
type BoundShapes = ReadonlyMap<string, WireShape | undefined>;

const UNBOUND: BoundShapes = new Map();

function membersShape(
  members: readonly ts.TypeElement[],
  declared: DeclaredTypes,
  seen: Set<string>,
  bound: BoundShapes,
): WireShape | undefined {
  const fields: Record<string, WireShape> = {};
  let values: WireShape | undefined;
  for (const member of members) {
    if (ts.isPropertySignature(member)) {
      const name =
        ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
          ? member.name.text
          : undefined;
      if (name === undefined) continue;
      const shape = wireShapeOf(member.type, declared, seen, bound);
      if (shape !== undefined) fields[name] = shape;
    } else if (ts.isIndexSignatureDeclaration(member)) {
      values = wireShapeOf(member.type, declared, seen, bound);
    }
  }
  if (Object.keys(fields).length > 0) return { fields };
  return values === undefined ? undefined : { values };
}

function interfaceShape(
  declaration: ts.InterfaceDeclaration,
  declared: DeclaredTypes,
  seen: Set<string>,
  bound: BoundShapes,
): WireShape | undefined {
  let shape = membersShape(declaration.members, declared, seen, bound);
  for (const clause of declaration.heritageClauses ?? []) {
    for (const parent of clause.types) {
      shape = mergeShapes(
        shape,
        referredShape(
          parent.expression.getText(),
          parent.typeArguments ?? [],
          declared,
          seen,
          bound,
        ),
      );
    }
  }
  return shape;
}

function declarationShape(
  declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  declared: DeclaredTypes,
  seen: Set<string>,
  bound: BoundShapes,
): WireShape | undefined {
  return ts.isTypeAliasDeclaration(declaration)
    ? wireShapeOf(declaration.type, declared, seen, bound)
    : interfaceShape(declaration, declared, seen, bound);
}

/** The shape of one of the contract's own types as a reference names
 * it. Each of its type parameters stands for the shape of the argument
 * given in its place, read where the reference is written, or for its
 * default's when the reference gives none; its own text sees its own
 * parameters alone. A type referred to inside its own declaration
 * reads as neither. */
function referredShape(
  name: string,
  args: readonly ts.TypeNode[],
  declared: DeclaredTypes,
  seen: Set<string>,
  bound: BoundShapes,
): WireShape | undefined {
  const declaration = declared.get(name);
  if (declaration === undefined || seen.has(name)) return undefined;
  const given = args.map((arg) => wireShapeOf(arg, declared, seen, bound));
  seen.add(name);
  const own = new Map<string, WireShape | undefined>();
  (declaration.typeParameters ?? []).forEach((parameter, index) => {
    own.set(
      parameter.name.text,
      index < given.length ? given[index] : wireShapeOf(parameter.default, declared, seen, own),
    );
  });
  const shape = declarationShape(declaration, declared, seen, own);
  seen.delete(name);
  return shape;
}

/** Where the dates and the bytes lie in a declared type: a `Date` or
 * a `Uint8Array` itself, or one reached through the contract's own
 * interfaces and aliases, a list, a record, a tuple, an intersection,
 * or a union with null or undefined. A generic type of the contract
 * reads with the arguments the reference gives it (`Page<Mail>` has
 * the dates of a `Mail` wherever its declaration names its parameter).
 * A union of different shapes, a generic the contract does not
 * declare, and a cycle read as neither. */
function wireShapeOf(
  node: ts.TypeNode | undefined,
  declared: DeclaredTypes,
  seen: Set<string>,
  bound: BoundShapes,
): WireShape | undefined {
  if (node === undefined) return undefined;
  if (ts.isParenthesizedTypeNode(node)) return wireShapeOf(node.type, declared, seen, bound);
  if (ts.isTypeOperatorNode(node)) return wireShapeOf(node.type, declared, seen, bound);
  if (ts.isArrayTypeNode(node)) {
    const items = wireShapeOf(node.elementType, declared, seen, bound);
    return items === undefined ? undefined : { items };
  }
  if (ts.isTupleTypeNode(node)) {
    const fields: Record<string, WireShape> = {};
    node.elements.forEach((element, index) => {
      const type = ts.isNamedTupleMember(element) ? element.type : element;
      if (ts.isRestTypeNode(type)) return;
      const shape = wireShapeOf(type, declared, seen, bound);
      if (shape !== undefined) fields[String(index)] = shape;
    });
    return Object.keys(fields).length === 0 ? undefined : { fields };
  }
  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.filter((part) => !isNullish(part));
    const [first, ...rest] = parts.map((part) => wireShapeOf(part, declared, seen, bound));
    if (first === undefined) return undefined;
    return rest.every((shape) => sameShape(shape, first)) ? first : undefined;
  }
  if (ts.isIntersectionTypeNode(node)) {
    let shape: WireShape | undefined;
    for (const part of node.types) {
      shape = mergeShapes(shape, wireShapeOf(part, declared, seen, bound));
    }
    return shape;
  }
  if (ts.isTypeLiteralNode(node)) return membersShape(node.members, declared, seen, bound);
  if (!ts.isTypeReferenceNode(node)) return undefined;
  const name = node.typeName.getText();
  const args = node.typeArguments ?? [];
  if (bound.has(name)) return bound.get(name);
  if (name === 'Date') return 'date';
  if (name === 'Uint8Array' || name === 'Buffer') return 'bytes';
  if (UNWRAPPED.has(name)) return wireShapeOf(args[0], declared, seen, bound);
  if (name === 'Array' || name === 'ReadonlyArray') {
    const items = wireShapeOf(args[0], declared, seen, bound);
    return items === undefined ? undefined : { items };
  }
  if (name === 'Record') {
    const values = wireShapeOf(args[1], declared, seen, bound);
    return values === undefined ? undefined : { values };
  }
  return referredShape(name, args, declared, seen, bound);
}

function wireShapesOf(
  parameters: readonly ts.ParameterDeclaration[],
  returnType: ts.TypeNode | undefined,
  declared: DeclaredTypes,
): WireShapes | undefined {
  const one = parameters.length === 1 && !endsInRest(parameters);
  const argument = one ? wireShapeOf(parameters[0]?.type, declared, new Set(), UNBOUND) : undefined;
  const each = one
    ? []
    : parameters.map((parameter) => wireShapeOf(parameter.type, declared, new Set(), UNBOUND));
  const several = each.some((shape) => shape !== undefined) ? each : undefined;
  const result = wireShapeOf(returnType, declared, new Set(), UNBOUND);
  if (argument === undefined && several === undefined && result === undefined) return undefined;
  return {
    ...(argument === undefined ? {} : { argument }),
    ...(several === undefined ? {} : { parameters: several }),
    ...(result === undefined ? {} : { result }),
  };
}

function isPromiseType(node: ts.TypeNode | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    return name === 'Promise' || name === 'PromiseLike';
  }
  if (ts.isUnionTypeNode(node)) return node.types.some((part) => isPromiseType(part));
  return false;
}

/** Reads a contract's declared functions and constants, in order. */
export function declaredSurfaceOf(contract: string): DeclaredSurface {
  const source = ts.createSourceFile(
    'contract.d.ts',
    contract,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const declared = declaredTypesOf(source);
  const functions: DeclaredFunction[] = [];
  const constants: string[] = [];
  // A name declared once more is the same function: one entry stands
  // for every overload of it.
  const declare = (entry: DeclaredFunction): void => {
    const at = functions.findIndex((known) => known.name === entry.name);
    const known = functions[at];
    if (known === undefined) functions.push(entry);
    else functions[at] = mergedOverload(known, entry);
  };
  // A contract's surface is what it exports; a flattened contract may
  // carry a sibling's private declaration beside it.
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (!exported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declare({
        name: statement.name.text,
        async: isPromiseType(statement.type),
        parameters: parameterNamesOf(statement.parameters),
        ...(endsInRest(statement.parameters) ? { rest: true } : {}),
        secret: isSecret(statement.parameters, statement.type, declared),
        ...shapesEntry(wireShapesOf(statement.parameters, statement.type, declared)),
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const type = declaration.type;
        if (type !== undefined && ts.isFunctionTypeNode(type)) {
          declare({
            name: declaration.name.text,
            async: isPromiseType(type.type),
            parameters: parameterNamesOf(type.parameters),
            ...(endsInRest(type.parameters) ? { rest: true } : {}),
            secret: isSecret(type.parameters, type.type, declared),
            ...shapesEntry(wireShapesOf(type.parameters, type.type, declared)),
          });
          continue;
        }
        constants.push(declaration.name.text);
      }
    }
  }
  return { functions, constants };
}

function shapesEntry(shapes: WireShapes | undefined): { shapes?: WireShapes } {
  return shapes === undefined ? {} : { shapes };
}

/** The wire shapes of the handlers that carry dates or bytes, by name. */
export function wireShapesOfSurface(surface: DeclaredSurface): Record<string, WireShapes> {
  const shapes: Record<string, WireShapes> = {};
  for (const entry of surface.functions) {
    if (entry.async && entry.shapes !== undefined) shapes[entry.name] = entry.shapes;
  }
  return shapes;
}

/** The handlers whose arguments or answer are secrets. */
export function secretHandlersOf(surface: DeclaredSurface): string[] {
  return surface.functions
    .filter((entry) => entry.async && entry.secret)
    .map((entry) => entry.name);
}

/** The promise-returning functions alone: the wire handlers. */
export function handlersOf(surface: DeclaredSurface): string[] {
  return surface.functions.filter((entry) => entry.async).map((entry) => entry.name);
}

/** What a stub declares for each wire handler: its parameter names in
 * order and whether the last is a rest parameter. The rule every road
 * follows: one plain parameter rides a call as itself, several or a
 * rest parameter ride it as one array, spread back on the served side. */
export type WireParameters = Readonly<
  Record<string, Pick<DeclaredFunction, 'parameters' | 'rest'>>
>;

/** The wire parameters of a surface's handlers, by name. */
export function wireParametersOf(
  surface: DeclaredSurface,
): Record<string, Pick<DeclaredFunction, 'parameters' | 'rest'>> {
  const declared: Record<string, Pick<DeclaredFunction, 'parameters' | 'rest'>> = {};
  for (const entry of surface.functions) {
    if (!entry.async) continue;
    declared[entry.name] = {
      parameters: entry.parameters,
      ...(entry.rest === undefined ? {} : { rest: entry.rest }),
    };
  }
  return declared;
}
