import { z } from 'zod';

export const encodeRequest = z.object({
  id: z.number().int().nonnegative(),
  blob: z.instanceof(Blob),
  originalType: z.string(),
  mode: z.enum(['upload', 'wasm']).optional(),
  quality: z.number().min(0).max(1).optional(),
});

export const encodeResponse = z.discriminatedUnion('ok', [
  z.object({
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    blob: z.instanceof(Blob),
    quality: z.number().min(0).max(1).optional(),
    duration: z.number().nonnegative().optional(),
  }),
  z.object({
    id: z.number().int().nonnegative(),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export type EncodeResponse = z.infer<typeof encodeResponse>;
