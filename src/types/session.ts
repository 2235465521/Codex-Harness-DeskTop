export interface AttachedImage {
  base64: string;
  path: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  thinking?: string;
  /** 本轮真实墙上耗时（秒），生成结束后写入；禁止再用 thinking 字数估算 */
  workDurationSec?: number;
  /** 上游正常关流但正文疑似截断（额度用尽等），可一键继续 */
  earlyEnded?: boolean;
  toolCall?: any;
  images?: string[]; // base64 or local paths
  timestamp: number;
}

export interface WorkspaceFolder {
  id: string;
  path: string;
  name: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  workspaceDir?: string;
  workspaceName?: string;
  isArchived?: boolean;
  forkedFrom?: string;
  messages: ChatMessage[];
}

export interface QueuedInstruction {
  id: string;
  prompt: string;
  images: AttachedImage[];
  timestamp: number;
}
