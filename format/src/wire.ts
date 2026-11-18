// Copyright (c) 2026 Cernanto.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// The relay protocol: the frames between the hosted webhook relay
// (hooks.cernanto.com) and the plane's webhook agent, which holds a
// socket to it. The gateway's own shapes live in the gateway's OpenAPI
// document, their one definition, and the cli reads them from its
// generated client (cli/src/gateway).

/** One frame the hosted relay sends down to a connected plane: a
 * webhook delivery captured on the public address, verified by the
 * consuming agent so the signing secret stays on the plane. The relay
 * sends it to every socket of the channel and holds the provider's
 * request for the response frame. */
export const relayDeliveryFrameSchema = z.object({
  kind: z.literal('delivery'),
  deliveryId: z.string().min(1),
  source: z.string().min(1),
  headers: z.record(z.string(), z.string()),
  bodyBase64: z.string(),
  /** The http method, lower case; absent means post. */
  method: z.string().optional(),
  /** The request's query parameters, single-valued. */
  query: z.record(z.string(), z.string()).optional(),
});
export type RelayDeliveryFrame = z.infer<typeof relayDeliveryFrameSchema>;

/** The plane's crafted answer for one relayed delivery: while the
 * relay still holds the provider's request, this frame becomes the
 * provider's response; after the relay's hold it is dropped, the
 * provider having been told to retry. */
export const relayResponseFrameSchema = z.object({
  kind: z.literal('response'),
  deliveryId: z.string().min(1),
  status: z.number().int().min(100).max(599),
  contentType: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyBase64: z.string(),
});
export type RelayResponseFrame = z.infer<typeof relayResponseFrameSchema>;

/** The relay's one word to a plane: the task this socket is attached
 * to is going. The plane opens its next socket at once, through the
 * public address, and keeps this one for the acknowledgements of what
 * it delivered until the relay closes it; this socket takes no more
 * deliveries. */
export const relayReconnectFrameSchema = z.object({
  kind: z.literal('reconnect'),
});
export type RelayReconnectFrame = z.infer<typeof relayReconnectFrameSchema>;
