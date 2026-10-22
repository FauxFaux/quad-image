import * as z from 'zod/mini';

export const encodeRequest = z.object({
  id: z.int().check(z.nonnegative()),
  blob: z.instanceof(Blob),
  originalType: z.string(),
  mode: z.optional(z.enum(['upload', 'wasm'])),
  quality: z.optional(z.number().check(z.minimum(0), z.maximum(1))),
});

export const encodeResponse = z.discriminatedUnion('ok', [
  z.object({
    id: z.int().check(z.nonnegative()),
    ok: z.literal(true),
    blob: z.instanceof(Blob),
    quality: z.optional(z.number().check(z.minimum(0), z.maximum(1))),
    duration: z.optional(z.number().check(z.nonnegative())),
  }),
  z.object({
    id: z.int().check(z.nonnegative()),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export type EncodeResponse = z.infer<typeof encodeResponse>;
