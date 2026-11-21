import { z } from 'zod';
export const userDTOSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});
export type UserDTO = z.infer<typeof userDTOSchema>;
