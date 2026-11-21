import type {
  ChatHistoryMessage,
  RetrievalDebug,
  Source,
  Usage,
  VisionMode,
} from '@nexus/contracts';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  /** Image documents attached to a user turn (vision chat). */
  attachments?: { imageDocumentIds: string[] } | null;
  usage?: Usage | null;
  feedback?: 'up' | 'down' | null;
  retrieval?: RetrievalDebug | null;
  error?: boolean;
  stopped?: boolean;
}

export interface PendingQuestion {
  workspaceId: string;
  message: string;
  conversationId?: string;
  history: ChatHistoryMessage[];
  regenerate?: boolean;
  persona?: string;
  imageDocumentIds?: string[];
  visionMode?: VisionMode;
}
