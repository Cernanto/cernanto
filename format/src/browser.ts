// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0

// The kit's entry a browser can load: what reads a source's labels, an
// id, a version and a contract, and the registry's public read side
// (where its files stand, their shapes, and the one ranking every
// client shares), with no module of Node's. The kit's reader of
// packages needs Node's hashing and its buffers, so it is not here: a
// browser asks the plane for what a package holds.
export * from './naming.js';
export * from './version.js';
export {
  packageIndexSchema,
  packagesSummarySchema,
  parsePackageRef,
  REGISTRY_INDEX_DEFAULT,
  REGISTRY_SUMMARY_PATH,
  registryIndexPath,
  searchSummary,
} from './registry.js';
export type { PackageIndex, PackagesSummary, SummaryRow } from './registry.js';
export { parseSpecLabels } from './spec-labels.js';
export type { SpecLabelIssue, SpecLabelName, SpecLabels, SpecLabelSection } from './spec-labels.js';
export {
  docSections,
  functionParameters,
  parameterFields,
  parametersOf,
  parseContract,
  plainParameter,
  plainTypeOf,
  recordParameter,
  wordOf,
} from './card-reader.js';
export type {
  ContractField,
  Declared,
  DeclaredAlias,
  DeclaredInterface,
  HandlerView,
  ParameterReading,
  ParameterView,
  ParsedContract,
  PlainField,
  PlainType,
} from './card-reader.js';
