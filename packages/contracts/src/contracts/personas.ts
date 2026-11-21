import { z } from 'zod';
export const personaDTOSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  /** True for the persona selected by the stored default setting. */
  isDefault: z.boolean(),
});
export type PersonaDTO = z.infer<typeof personaDTOSchema>;
