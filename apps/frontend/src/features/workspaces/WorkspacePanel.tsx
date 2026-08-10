import { ChatPanel } from '../chat/ChatPanel';
import { DocumentList } from '../upload/DocumentList';
import { UploadDropzone } from '../upload/UploadDropzone';

interface Props {
  workspaceId: string;
}

export function WorkspacePanel({ workspaceId }: Props) {
  return (
    <div className="flex h-full">
      <ChatPanel workspaceId={workspaceId} />
      <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/40">
        <UploadDropzone workspaceId={workspaceId} />
        <DocumentList workspaceId={workspaceId} />
      </aside>
    </div>
  );
}