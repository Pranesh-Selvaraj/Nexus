import { z } from 'zod';
export const workspacePlanSchema = z.object({
  title: z.string(),
  steps: z.array(z.string()),
});
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>;

export const workspaceRoleSchema = z.enum(['owner', 'editor', 'reader']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: workspaceRoleSchema,
  createdAt: z.string(),
});
export type WorkspaceMemberDTO = z.infer<typeof workspaceMemberSchema>;

export const addWorkspaceMemberInputSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email().max(200),
  role: z.enum(['editor', 'reader']),
});
export type AddWorkspaceMemberInput = z.infer<
  typeof addWorkspaceMemberInputSchema
>;

export const updateWorkspaceMemberInputSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['editor', 'reader']),
});

export const removeWorkspaceMemberInputSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const workspaceMetadataSchema = z.object({
  packId: z.string().optional(),
  icon: z.string().optional(),
  personaId: z.string().optional(),
  starterPrompts: z.array(z.string()).optional(),
  plan: workspacePlanSchema.optional(),
});
export type WorkspaceMetadata = z.infer<typeof workspaceMetadataSchema>;

export const workspaceDTOSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  /** Present for topics installed from a domain pack. */
  metadata: workspaceMetadataSchema.nullable().optional(),
  /** The caller's role in this workspace. */
  role: workspaceRoleSchema.optional(),
});
export type WorkspaceDTO = z.infer<typeof workspaceDTOSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const workspaceIdSchema = z.object({
  workspaceId: z.string().uuid(),
});
