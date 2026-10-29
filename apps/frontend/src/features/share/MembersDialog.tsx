import { useState } from 'react';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
  isOwner: boolean;
  onClose: () => void;
}

/**
 * Workspace members and roles (L-13). Any member can see who else is here;
 * only the owner can add people, change roles or remove them. Readers can
 * learn from the topic but cannot change its content.
 */
export function MembersDialog({ workspaceId, isOwner, onClose }: Props) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const members = trpc.members.list.useQuery({ workspaceId });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'reader' | 'editor'>('reader');

  const add = trpc.members.add.useMutation({
    onSuccess: () => {
      setEmail('');
      void utils.members.list.invalidate({ workspaceId });
      void utils.workspace.list.invalidate();
      toast.push({ kind: 'success', message: 'Member added' });
    },
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });
  const updateRole = trpc.members.updateRole.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate({ workspaceId });
      toast.push({ kind: 'success', message: 'Role updated' });
    },
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });
  const remove = trpc.members.remove.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate({ workspaceId });
      void utils.workspace.list.invalidate();
      toast.push({ kind: 'info', message: 'Member removed' });
    },
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace members"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-700 bg-zinc-900 p-5 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Members</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Readers can learn and ask questions. Editors can also add sources
              and generate practice. Only the owner manages members and the
              topic itself.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        {members.isLoading && (
          <p className="mt-4 text-xs text-zinc-500">Loading members...</p>
        )}

        <ul className="mt-3 space-y-1.5">
          {members.data?.map((member) => {
            const isCreator = member.role === 'owner';
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-200">
                    {member.name ?? member.email}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {member.email}
                  </p>
                </div>
                {isOwner && !isCreator ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={member.role}
                      onChange={(event) =>
                        updateRole.mutate({
                          workspaceId,
                          userId: member.userId,
                          role: event.target.value as 'reader' | 'editor',
                        })
                      }
                      aria-label={`Role for ${member.email}`}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300"
                    >
                      <option value="reader">Reader</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      onClick={() =>
                        remove.mutate({ workspaceId, userId: member.userId })
                      }
                      disabled={remove.isPending}
                      className="rounded-lg border border-red-900/60 px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/40 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase text-zinc-400">
                    {member.role}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {isOwner && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!email.trim()) return;
              add.mutate({ workspaceId, email: email.trim(), role });
            }}
            className="mt-4 border-t border-zinc-800 pt-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Add a member
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="their account email"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
              />
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as 'reader' | 'editor')
                }
                aria-label="New member role"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-300"
              >
                <option value="reader">Reader</option>
                <option value="editor">Editor</option>
              </select>
              <button
                type="submit"
                disabled={add.isPending || !email.trim()}
                className="rounded-lg bg-nexus-600 px-3 py-2 text-xs font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
              >
                {add.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              The person needs an existing account. Registration is controlled
              by the deployment (ALLOW_REGISTRATION); ask your administrator if
              they cannot sign in yet.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
