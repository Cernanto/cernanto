// Copyright (c) 2026 Cernanto. All rights reserved.
// SPDX-License-Identifier: BUSL-1.1
import { z } from 'zod';

// The OpenAPI grant's shared seam: the compiler generates one typed
// module per granted document, each function carrying its operation
// binding as a plain literal, and the runtime executes the binding as a
// journaled step in the calling agent's own worker. The binding is the
// whole wire of this lane.

/** Where one operation parameter rides on the request: the path, the
 * query or a header. Cookie parameters are unsupported. */
const openApiParameterSchema = z.object({
  name: z.string().min(1),
  in: z.enum(['path', 'query', 'header']),
  required: z.boolean(),
});

/** How the operation authenticates, mapped from the document's security
 * schemes. `bearer` covers http bearer, oauth2, and openid connect
 * (all bearer tokens at the wire); the apiKey schemes name the header
 * or query parameter that carries the secret. The secret itself
 * resolves from custody at call time and stays out of every binding,
 * journal and trace. */
const openApiSecuritySchema = z.object({
  scheme: z.enum(['bearer', 'apiKeyHeader', 'apiKeyQuery']),
  /** The header or query parameter name, for the apiKey schemes. */
  name: z.string().min(1).optional(),
  /** The document's own description of the scheme ("Personal Access
   * Token, generate one from the developer dashboard"): it authors
   * the operator ask when the credential is missing at call time. */
  description: z.string().optional(),
});

/** One operation of a granted OpenAPI document, embedded verbatim in
 * the generated module and executed by the runtime. */
export const openApiOperationBindingSchema = z.object({
  /** The generated module's name, `godaddy` for api.godaddy.com. */
  module: z.string().min(1),
  /** The generated function's name, unique within the module. */
  operation: z.string().min(1),
  /** The resolved server url the paths append to. */
  baseUrl: z.string().min(1),
  method: z.enum(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']),
  /** The path template, `{name}` placeholders included. */
  path: z.string().min(1),
  parameters: z.array(openApiParameterSchema),
  /** Whether the operation accepts a json request body. */
  hasBody: z.boolean(),
  security: openApiSecuritySchema.optional(),
});
export type OpenApiOperationBinding = z.infer<typeof openApiOperationBindingSchema>;

/** The arguments one generated operation function passes through:
 * grouped the way the document declares them, so a path value is told
 * from a query value. `headers` is an accepted alias of `header`,
 * because the type engine's operation types name the group in the
 * plural. */
export const openApiCallArgsSchema = z.object({
  path: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  header: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
});
export type OpenApiCallArgs = z.infer<typeof openApiCallArgsSchema>;
