import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { ChatStream } from '@/components/ChatStream/ChatStream';
import { Composer } from '@/components/Composer/Composer';
import { PreviewPanel } from '@/components/PreviewPanel/PreviewPanel';
import { StatusBar, GenerationMetrics } from '@/components/StatusBar';
import { SettingsModal } from '@/components/Modals/SettingsModal';
import { ConnectorsModal } from '@/components/Modals/ConnectorsModal';
import { ThemeModal } from '@/components/Modals/ThemeModal';
import { AboutModal } from '@/components/Modals/AboutModal';
import { FeedbackModal } from '@/components/Modals/FeedbackModal';
import { UpdatePromptModal } from '@/components/Modals/UpdatePromptModal';
import { ImageLightbox } from '@/components/Modals/ImageLightbox';

import { useTheme } from '@/hooks/useTheme';
import { useProviders } from '@/hooks/useProviders';
import { useSessions } from '@/hooks/useSessions';
import { useTabQueue } from '@/hooks/useTabQueue';
import { useUpdater } from '@/hooks/useUpdater';

import { AttachedImage, ChatMessage } from '@/types/session';
import { SkillItem, PermissionMode, WorkspaceFileItem, ConnectorToolInfo } from '@/types/electron';
import { Download, Layers, Plug } from 'lucide-react';

function normalizeFsPath(p?: string | null): string {
  if (!p) return '';
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 上游正常关流但正文疑似提前结束（额度 / 未闭合围栏 / 半截句） */
function looksLikeEarlyEnd(content: string, finishReason?: string): boolean {
  const fr = String(finishReason || '').toLowerCase();
  if (fr === 'length' || fr === 'max_tokens') return true;
  // 工具调用收束本身不算正文截断；轮次打满仍挂 tool 由调用方单独标记
  if (fr === 'tool_calls' || fr === 'tool_use') return false;

  const text = String(content || '').replace(/\s+$/u, '');
  if (!text) return false;

  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 === 1) return true;

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1] || '';
  if (/[,，、:：;；]\s*$/u.test(lastLine)) return true;

  // 半截长句：仅对含中文的末行启用，避免英文无句号段落误报
  if (
    lastLine.length >= 24 &&
    /[\u4e00-\u9fff]/.test(lastLine) &&
    !/([.!?。！？…」』）\]}`])\s*$/u.test(lastLine) &&
    !/^#{1,6}\s/.test(lastLine) &&
    !/^[-*]\s+\S+$/u.test(lastLine.trim())
  ) {
    return true;
  }
  return false;
}

const EARLY_END_MARKER = '[输出提前结束]';
const EARLY_END_NOTE_RE = /\n*\n⚠️\s*\[输出提前结束\][^\n]*(?:\n(?!\n)[^\n]*)*$/u;
const CONTINUE_PROMPT = '请从上次中断处继续写完，不要重复已输出的内容。';

/** 兼容模型误传 path / file */
function pickRelativePath(args: Record<string, unknown> | null | undefined): string {
  if (!args || typeof args !== 'object') return '';
  const raw = args.relativePath ?? args.path ?? args.file;
  return String(raw ?? '').trim();
}

const AT_FILE_EXT = 'docx|xlsx|xls|pdf|doc|pptx|txt|md|json|js|jsx|ts|tsx|mjs|cjs|py|css|html|htm|yml|yaml|xml|csv|sh|ps1|java|go|rs|toml|ini|vue';

/** 从消息里抽出 @路径。支持中文、空格，以及 @"路径" 引号形式。 */
function extractAtFileRefs(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(
    `@"([^"]+)"|@'([^']+)'|@([^\\s@"'][^\\n@]*?\\.(?:${AT_FILE_EXT}))(?=[\\s,，。；;）)]|$)`,
    'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = (m[1] || m[2] || m[3] || '').trim();
    if (p) found.push(p);
  }
  return [...new Set(found)];
}

function indirectOfficeHint(rel: string): string | null {
  const dot = rel.lastIndexOf('.');
  const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
  if (ext === '.xlsx' || ext === '.xls' || ext === '.doc' || ext === '.pptx') {
    return `【文件未挂载: ${rel}】该格式不能直接读取，请另存为 .txt / .md / .csv 后再用 @ 引用`;
  }
  return null;
}

/** OpenAI / Anthropic 共用的工作区写盘工具定义 */
const WRITE_WORKSPACE_FILE_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'write_workspace_file',
    description:
      '将完整文件内容写入当前 Codex Desktop 工作区。用于创建或覆盖代码、Markdown 文档等。content 必须是完整文件正文，禁止省略占位符。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: {
          type: 'string',
          description: '相对工作区根目录的路径，如 docs/report.md 或 src/App.tsx',
        },
        content: {
          type: 'string',
          description: '完整文件内容',
        },
      },
      required: ['relativePath', 'content'],
    },
  },
};

const WRITE_WORKSPACE_FILE_TOOL_ANTHROPIC = {
  name: 'write_workspace_file',
  description: WRITE_WORKSPACE_FILE_TOOL_OPENAI.function.description,
  input_schema: WRITE_WORKSPACE_FILE_TOOL_OPENAI.function.parameters,
};

/** OpenAI / Anthropic 共用的工作区读文件工具。只读路径，复用已有 readWorkspaceFile。 */
const READ_WORKSPACE_FILE_TOOL_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'read_workspace_file',
    description:
      '读取当前工作区中尚未出现在本轮上下文里的一个文件。relativePath 必须是相对工作区根目录的路径。返回文本正文；.docx 与文字型 PDF 会抽取正文。二进制、.xlsx/.xls/.doc/.pptx，以及无文字层的扫描 PDF 会失败。超限会截断并注明，不是全文。用户已用 @ 挂载的同一路径不必重复读取。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: {
          type: 'string',
          description: '相对工作区根目录的路径，如 src/App.tsx 或 docs/report.md',
        },
      },
      required: ['relativePath'],
    },
  },
};

const READ_WORKSPACE_FILE_TOOL_ANTHROPIC = {
  name: 'read_workspace_file',
  description: READ_WORKSPACE_FILE_TOOL_OPENAI.function.description,
  input_schema: READ_WORKSPACE_FILE_TOOL_OPENAI.function.parameters,
};

function localWorkspaceToolsOpenAI(canRead: boolean, canWrite: boolean) {
  return [
    ...(canRead ? [READ_WORKSPACE_FILE_TOOL_OPENAI] : []),
    ...(canWrite ? [WRITE_WORKSPACE_FILE_TOOL_OPENAI] : []),
  ];
}

function localWorkspaceToolsAnthropic(canRead: boolean, canWrite: boolean) {
  return [
    ...(canRead ? [READ_WORKSPACE_FILE_TOOL_ANTHROPIC] : []),
    ...(canWrite ? [WRITE_WORKSPACE_FILE_TOOL_ANTHROPIC] : []),
  ];
}

type CodexToolCall = { id?: string; name: string; arguments: string };

/** 解析标记块兜底：@@@write_file path="a.md"\\n...@@@end */
function extractTaggedWriteFiles(text: string): { relativePath: string; content: string }[] {
  const out: { relativePath: string; content: string }[] = [];
  const re = /@@@write_file\s+path=["']([^"']+)["']\s*\r?\n([\s\S]*?)@@@end/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ relativePath: m[1].trim().replace(/^[./\\]+/, ''), content: m[2].replace(/^\uFEFF/, '') });
  }
  return out;
}

async function executeWriteWorkspaceTools(
  toolCalls: CodexToolCall[],
  onFileWritten?: (path: string) => void
): Promise<{ lines: string[]; results: { id: string; name: string; content: string }[] }> {
  const lines: string[] = [];
  const results: { id: string; name: string; content: string }[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const callId = tc.id || `call_${i}_${Date.now()}`;
    if (tc.name !== 'write_workspace_file') {
      const msg = `⏭ 忽略未知工具 \`${tc.name}\``;
      lines.push(`- ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    let args: { relativePath?: string; path?: string; file?: string; content?: string } = {};
    try {
      args = JSON.parse(tc.arguments || '{}');
    } catch {
      const msg = 'write_workspace_file 参数 JSON 解析失败';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    const relativePath = pickRelativePath(args as Record<string, unknown>);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!relativePath || !content) {
      const msg = 'write_workspace_file 缺少 relativePath 或 content';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    if (!window.codexDesktop?.writeWorkspaceFile) {
      const msg = '当前环境不支持写盘';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    try {
      const res = await window.codexDesktop.writeWorkspaceFile({
        relativePath,
        content,
        createBackup: true,
      });
      if (res?.ok) {
        lines.push(`- ✅ 已写入 \`${relativePath}\``);
        results.push({
          id: callId,
          name: tc.name,
          content: JSON.stringify({ ok: true, relativePath }),
        });
        onFileWritten?.(relativePath);
      } else {
        const err = (res as any)?.reason || (res as any)?.error || '未知错误';
        lines.push(`- ❌ 写入失败 \`${relativePath}\`: ${err}`);
        results.push({
          id: callId,
          name: tc.name,
          content: JSON.stringify({ ok: false, relativePath, error: err }),
        });
      }
    } catch (e: any) {
      const err = e?.message || String(e);
      lines.push(`- ❌ 写入异常 \`${relativePath}\`: ${err}`);
      results.push({
        id: callId,
        name: tc.name,
        content: JSON.stringify({ ok: false, relativePath, error: err }),
      });
    }
  }
  return { lines, results };
}

async function executeReadWorkspaceTools(
  toolCalls: CodexToolCall[]
): Promise<{ lines: string[]; results: { id: string; name: string; content: string }[] }> {
  const lines: string[] = [];
  const results: { id: string; name: string; content: string }[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const callId = tc.id || `call_${i}_${Date.now()}`;
    if (tc.name !== 'read_workspace_file') {
      const msg = `⏭ 忽略未知工具 \`${tc.name}\``;
      lines.push(`- ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    let args: { relativePath?: string; path?: string; file?: string } = {};
    try {
      args = JSON.parse(tc.arguments || '{}');
    } catch {
      const msg = 'read_workspace_file 参数 JSON 解析失败';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    const relativePath = pickRelativePath(args as Record<string, unknown>);
    if (!relativePath) {
      const msg = 'read_workspace_file 缺少 relativePath';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    const blockedOffice = indirectOfficeHint(relativePath);
    if (blockedOffice) {
      lines.push(`- ❌ 读取失败 \`${relativePath}\`: 该格式不能直接读取`);
      results.push({ id: callId, name: tc.name, content: blockedOffice });
      continue;
    }
    if (!window.codexDesktop?.readWorkspaceFile) {
      const msg = '当前环境不支持读文件';
      lines.push(`- ❌ ${msg}`);
      results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
      continue;
    }
    try {
      const res = await window.codexDesktop.readWorkspaceFile(relativePath);
      if (res?.ok) {
        const body = typeof res.content === 'string' ? res.content : '';
        const text = body.length > 0 ? body : `【空文件】${relativePath} 存在，但没有可读正文。`;
        const truncatedNote =
          res.isTruncated && !text.includes('已截取') && !text.includes('仅截取')
            ? '\n\n[部分内容：本次不是全文，剩余部分已略去]'
            : '';
        lines.push(`- ✅ 已读取 \`${relativePath}\`${res.isTruncated ? '（已截断）' : ''}`);
        results.push({ id: callId, name: tc.name, content: text + truncatedNote });
      } else {
        const err = res?.reason || res?.code || '读取失败';
        lines.push(`- ❌ 读取失败 \`${relativePath}\`: ${err}`);
        results.push({
          id: callId,
          name: tc.name,
          content: JSON.stringify({ ok: false, relativePath, error: err, hint: res?.hint || '' }),
        });
      }
    } catch (e: any) {
      const err = e?.message || String(e);
      lines.push(`- ❌ 读取异常 \`${relativePath}\`: ${err}`);
      results.push({
        id: callId,
        name: tc.name,
        content: JSON.stringify({ ok: false, relativePath, error: err }),
      });
    }
  }
  return { lines, results };
}

/** 读盘 / 写盘 / MCP 工具多轮上限（首轮 + 续轮，对齐连接器规格默认 5） */
const MAX_WRITE_TOOL_ROUNDS = 5;

function isAgentToolName(name: string) {
  return name === 'read_workspace_file' || name === 'write_workspace_file' || name.startsWith('mcp__');
}

function connectorToolsToOpenAI(tools: ConnectorToolInfo[]) {
  return tools
    .filter((t) => t.qualifiedName && t.name && !t.error)
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.qualifiedName as string,
        description: `[连接器:${t.connectorName || t.connectorId}] ${t.description || t.name}`,
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
}

function connectorToolsToAnthropic(tools: ConnectorToolInfo[]) {
  return tools
    .filter((t) => t.qualifiedName && t.name && !t.error)
    .map((t) => ({
      name: t.qualifiedName as string,
      description: `[连接器:${t.connectorName || t.connectorId}] ${t.description || t.name}`,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    }));
}

async function executeAgentTools(
  toolCalls: CodexToolCall[],
  onFileWritten?: (path: string) => void
): Promise<{ lines: string[]; results: { id: string; name: string; content: string }[] }> {
  const lines: string[] = [];
  const results: { id: string; name: string; content: string }[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const callId = tc.id || `call_${i}_${Date.now()}`;

    if (tc.name === 'read_workspace_file') {
      const one = await executeReadWorkspaceTools([{ ...tc, id: callId }]);
      lines.push(...one.lines);
      results.push(...one.results);
      continue;
    }

    if (tc.name === 'write_workspace_file') {
      const one = await executeWriteWorkspaceTools([{ ...tc, id: callId }], onFileWritten);
      lines.push(...one.lines);
      results.push(...one.results);
      continue;
    }

    if (tc.name.startsWith('mcp__')) {
      const parts = tc.name.split('__');
      const connectorId = parts[1] || '';
      const toolName = parts.slice(2).join('__');
      if (!connectorId || !toolName || !window.codexDesktop?.callConnectorTool) {
        const msg = 'MCP 工具调用参数不完整或环境不支持';
        lines.push(`- ❌ ${msg}`);
        results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
        continue;
      }
      try {
        const res = await window.codexDesktop.callConnectorTool({
          connectorId,
          name: toolName,
          arguments: tc.arguments,
        });
        if (res?.ok) {
          const content =
            typeof res.result === 'string'
              ? res.result
              : JSON.stringify(res.result ?? {}, null, 0).slice(0, 80000);
          lines.push(`- ✅ MCP \`${toolName}\`（${connectorId}）`);
          results.push({ id: callId, name: tc.name, content });
        } else {
          const err = res?.error || '调用失败';
          lines.push(`- ❌ MCP \`${toolName}\`: ${err}`);
          results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: err }) });
        }
      } catch (e: any) {
        const err = e?.message || String(e);
        lines.push(`- ❌ MCP 异常 \`${toolName}\`: ${err}`);
        results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: err }) });
      }
      continue;
    }

    const msg = `忽略未知工具 \`${tc.name}\``;
    lines.push(`- ⏭ ${msg}`);
    results.push({ id: callId, name: tc.name, content: JSON.stringify({ ok: false, error: msg }) });
  }

  return { lines, results };
}

export const App: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { providers, saveProviders, selectedModel, selectModel, allModels } = useProviders();
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    createNewSession,
    renameSession,
    updateCurrentSessionWorkspace,
    forkSession,
    toggleArchiveSession,
    moveSessionToWorkspace,
    deleteSession,
    addMessageToCurrentSession,
    updateLastMessageInCurrentSession,
    clearCurrentSessionMessages,
    exportCurrentSessionAsMarkdown,
    rollbackMessage,
  } = useSessions();
  const { queue, enqueue, dequeue, removeQueueItem } = useTabQueue();
  const {
    updateInfo,
    isModalOpen: isUpdateModalOpen,
    isDownloading: isUpdateDownloading,
    progress: updateProgress,
    isDownloaded: isUpdateDownloaded,
    downloadedVersion,
    startDownload,
    closeModal: closeUpdateModal,
    checkForUpdates,
  } = useUpdater();

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMetrics, setGenerationMetrics] = useState<GenerationMetrics>({
    isGenerating: false,
    firstTokenLatencyMs: null,
    speedTokPerSec: null,
    cacheHitPercent: null,
    inputTokens: null,
    outputTokens: null,
  });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    title: string;
    filePath?: string;
    codeContent: string;
    originalContent?: string | null;
    hasBackup?: boolean;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const [inputPrompt, setInputPrompt] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsTabSignal, setSkillsTabSignal] = useState(0);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('workspace-readonly');
  const [activeWorkspaceDir, setActiveWorkspaceDir] = useState<string | null>(null);
  const [workspaceRefreshTrigger, setWorkspaceRefreshTrigger] = useState(0);
  const activeStreamIdRef = useRef<string | null>(null);

  // 同步主进程权威安全沙箱状态与当前活跃会话工作区
  useEffect(() => {
    if (window.codexDesktop?.getSecurityStatus) {
      window.codexDesktop.getSecurityStatus().then(st => {
        if (st) {
          if (st.permissionMode) setPermissionMode(st.permissionMode);
          // 权威原则：以当前会话保存的工作区为最高优先级准则
          if (currentSession?.workspaceDir) {
            setActiveWorkspaceDir(currentSession.workspaceDir);
            window.codexDesktop?.setWorkspaceDir?.(currentSession.workspaceDir);
          } else {
            // 当前会话为通用独立会话，主动清理全局残留，杜绝旧项目污染
            setActiveWorkspaceDir(null);
            window.codexDesktop?.setWorkspaceDir?.(null as any);
          }
        }
      });
    }
  }, []);

  const handleSelectPermissionMode = async (mode: PermissionMode) => {
    if (window.codexDesktop?.setPermissionMode) {
      const res = await window.codexDesktop.setPermissionMode(mode);
      if (res && res.ok) {
        setPermissionMode(res.permissionMode);
      }
    } else {
      setPermissionMode(mode);
    }
  };

  // 切换会话：自动且无缝联动将工作区切实切换到该会话所属的项目目录
  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    const target = sessions.find(s => s.id === sessionId);
    const targetDir = target?.workspaceDir || null;
    setActiveWorkspaceDir(targetDir);
    if (window.codexDesktop?.setWorkspaceDir) {
      window.codexDesktop.setWorkspaceDir(targetDir);
    }
    if (targetDir) {
      localStorage.setItem('codex_workspace_dir', targetDir);
    } else {
      localStorage.removeItem('codex_workspace_dir');
    }
  };

  // 切换或挂载新工作区：激活该工作区，并自动选中属于该工作区的会话；若尚无会话，则为其新建一个专属新会话
  const handleWorkspaceChange = (path: string) => {
    setActiveWorkspaceDir(path);
    if (window.codexDesktop?.setWorkspaceDir) {
      window.codexDesktop.setWorkspaceDir(path);
    }
    if (path) {
      localStorage.setItem('codex_workspace_dir', path);
    } else {
      localStorage.removeItem('codex_workspace_dir');
    }
    const folderName = path.replace(/[\\/]$/, '').split(/[\\/]/).pop() || '工程';

    // 绝对禁止篡改当前已有会话的所属工程！
    // 检查目标工作区下是否已有属于它的会话（使用路径标准化对比，杜绝大小写与正反斜杠失配）：
    const existingInWorkspace = sessions.filter(s => normalizeFsPath(s.workspaceDir) === normalizeFsPath(path));
    if (existingInWorkspace.length > 0) {
      // 切换到目标工程下的首个会话
      setCurrentSessionId(existingInWorkspace[0].id);
    } else {
      // 若该工程下暂无任何会话，自动生成一个专属的新会话
      createNewSession(selectedModel, path, folderName);
    }
  };

  // 点击左侧文件树中任一文件：安全沙箱内读取源码与差异并展开右侧预览抽屉
  const handleSelectFile = async (item: WorkspaceFileItem) => {
    if (item.isDirectory) return;
    try {
      if (window.codexDesktop?.readWorkspaceFileDiff) {
        const diffRes = await window.codexDesktop.readWorkspaceFileDiff(item.path);
        if (diffRes && diffRes.ok) {
          setPreviewFile({
            title: item.name,
            filePath: item.path,
            codeContent: diffRes.currentContent,
            originalContent: diffRes.originalContent,
            hasBackup: diffRes.hasBackup,
          });
          setIsPreviewOpen(true);
          return;
        }
      } else if (window.codexDesktop?.readWorkspaceFile) {
        const res = await window.codexDesktop.readWorkspaceFile(item.path);
        if (res && res.content !== undefined) {
          setPreviewFile({
            title: item.name,
            filePath: item.path,
            codeContent: res.content,
            originalContent: null,
            hasBackup: false,
          });
          setIsPreviewOpen(true);
          return;
        }
      }
    } catch (err) {
      console.error('读取预览文件异常:', err);
    }
    setPreviewFile({
      title: item.name,
      filePath: item.path,
      codeContent: `// 无法读取或内容为空: ${item.path}`,
      originalContent: null,
      hasBackup: false,
    });
  };

  // 当代码块中的内容被安全写回磁盘时，自动拉取最新物理文件与 Diff、展开右侧代码预览面板，并触发左侧文件树刷新
  const handleFileWritten = async (filePath: string) => {
    // 触发左侧文件树重新扫描，确保刚创建或修改的文件/文件夹立即出现在文件树中
    setWorkspaceRefreshTrigger(prev => prev + 1);

    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;

    if (window.codexDesktop?.readWorkspaceFileDiff) {
      try {
        const diffRes = await window.codexDesktop.readWorkspaceFileDiff(filePath);
        if (diffRes && diffRes.ok) {
          setPreviewFile({
            title: fileName,
            filePath,
            codeContent: diffRes.currentContent,
            originalContent: diffRes.originalContent,
            hasBackup: diffRes.hasBackup,
          });
          setIsPreviewOpen(true);
          return;
        }
      } catch (err) {
        console.error('刷新已写入文件 Diff 预览失败:', err);
      }
    }

    if (window.codexDesktop?.readWorkspaceFile) {
      try {
        const res = await window.codexDesktop.readWorkspaceFile(filePath);
        if (res && res.ok && typeof res.content === 'string') {
          setPreviewFile({
            title: fileName,
            filePath,
            codeContent: res.content,
            originalContent: null,
            hasBackup: false,
          });
          setIsPreviewOpen(true);
        }
      } catch (err) {
        console.error('刷新已写入文件预览失败:', err);
      }
    }
  };

  // 一键撤销 AI 变更，将文件原子回滚为修改前的 .bak 版本
  const handleRevertFile = async (filePath: string) => {
    if (!window.codexDesktop?.revertWorkspaceFile) return;
    try {
      const res = await window.codexDesktop.revertWorkspaceFile(filePath);
      if (res && res.ok && typeof res.content === 'string') {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
        setPreviewFile({
          title: fileName,
          filePath,
          codeContent: res.content,
          originalContent: null,
          hasBackup: false,
        });
        // 触发文件树刷新
        setWorkspaceRefreshTrigger(prev => prev + 1);
      } else {
        alert(res?.reason || '还原文件失败');
      }
    } catch (err) {
      console.error('还原文件异常:', err);
      alert('还原失败: ' + (err as Error).message);
    }
  };

  // 加载 43 项全流程技能库
  useEffect(() => {
    if (window.codexDesktop && window.codexDesktop.getSkills) {
      window.codexDesktop.getSkills().then(list => {
        if (Array.isArray(list)) setSkills(list);
      });
    }
  }, []);

  // 呼出 / 菜单时刷新合并技能列表，使新建/导入的用户技能即时可见
  const slashMenuOpen = inputPrompt.startsWith('/');
  useEffect(() => {
    if (!slashMenuOpen) return;
    if (!window.codexDesktop?.getSkills) return;
    let cancelled = false;
    window.codexDesktop.getSkills().then(list => {
      if (!cancelled && Array.isArray(list)) setSkills(list);
    });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen]);

  // 监听原生主菜单 IPC 事件
  useEffect(() => {
    if (window.codexDesktop && window.codexDesktop.onMenuAction) {
      window.codexDesktop.onMenuAction((action) => {
        if (action === 'new-chat') {
          const folderName = activeWorkspaceDir ? activeWorkspaceDir.replace(/[\\/]$/, '').split(/[\\/]/).pop() : undefined;
          createNewSession(selectedModel, activeWorkspaceDir || undefined, folderName);
        }
        if (action === 'export-chat') exportCurrentSessionAsMarkdown();
        if (action === 'open-settings') setIsSettingsOpen(true);
        if (action === 'open-theme') setIsThemeOpen(true);
        if (action === 'open-about') setIsAboutOpen(true);
        if (action === 'open-feedback') setIsFeedbackOpen(true);
        if (action.startsWith('theme:')) {
          const t = action.split(':')[1] as any;
          setTheme(t);
        }
      });
    }
  }, [selectedModel, activeWorkspaceDir]);

  // Tab Queueing 自动消费状态机
  useEffect(() => {
    if (!isGenerating && queue.length > 0) {
      const nextTask = dequeue();
      if (nextTask) {
        executeLLMTask(nextTask.prompt, nextTask.images);
      }
    }
  }, [isGenerating, queue]);

  const handleSend = (text: string, images: AttachedImage[]) => {
    const trimmed = text.trim();

    // Slash Commands 快速拦截
    if (trimmed === '/clear') {
      clearCurrentSessionMessages();
      return;
    }
    if (trimmed === '/diff') {
      setIsPreviewOpen(true);
      return;
    }
    if (trimmed === '/skills' || trimmed === '/skills/') {
      setSkillsTabSignal((n) => n + 1);
      const skillsHint: ChatMessage = {
        role: 'assistant',
        model: selectedModel,
        thinking: '技能库',
        content:
          `📚 **已打开左侧「技能」面板**（共 ${skills.length} 项）\n` +
          `- 点选技能详情 →「填入指令」或在输入框输入 \`/<技能id> 你的任务\`\n` +
          `- 「我的」页可导入/新建/编辑/删除自定义技能（内置技能不可删）\n` +
          `- 发送前会刷新技能列表，新建后可立即 \`/id\` 激活`,
        timestamp: Date.now(),
      };
      addMessageToCurrentSession(skillsHint);
      return;
    }
    if (trimmed === '/status') {
      const statusMsg: ChatMessage = {
        role: 'assistant',
        model: selectedModel,
        thinking: 'Codex 核心与通道检测',
        content: `⚡ **Codex 状态就绪**\n- 当前所选模型: \`${selectedModel}\`\n- 已装载技能库: \`${skills.length}\` 项全流程技能\n- 本地网络管道: \`正常\``,
        timestamp: Date.now()
      };
      addMessageToCurrentSession(statusMsg);
      return;
    }
    if (trimmed === '/help') {
      const helpMsg: ChatMessage = {
        role: 'assistant',
        model: selectedModel,
        thinking: '帮助说明',
        content: `📖 **Codex Desktop 快捷操作指南**\n- 输入 \`/\`：呼出系统指令与技能库\n- 输入 \`/skills\`：打开左侧技能面板\n- 输入 \`/<技能id> 任务\`：激活技能并注入 SKILL.md\n- 输入 \`/status\`：检查当前模型通道与内核就绪状态\n- 输入 \`/diff\`：打开右侧工作区变更预览\n- 输入 \`/clear\`：清空当前会话\n- 输入 \`@相对路径\`：挂载工作区文本；\`.docx\` / \`.pdf\` 会抽取正文（支持中文路径）\n- 粘贴图片 (\`Ctrl+V\`)：多模态看图编程`,
        timestamp: Date.now()
      };
      addMessageToCurrentSession(helpMsg);
      return;
    }

    // 若 Agent 当前处于生成/思考中，自动进入 Tab Queueing 队列
    if (isGenerating) {
      enqueue(trimmed, images);
      return;
    }

    executeLLMTask(trimmed, images);
  };

  const executeLLMTask = async (text: string, images: AttachedImage[]) => {
    setIsGenerating(true);

    // 发送前刷新技能列表，确保新建/导入的用户技能可立即被 /id 激活
    let skillsSnapshot = skills;
    if (window.codexDesktop?.getSkills) {
      try {
        const list = await window.codexDesktop.getSkills();
        if (Array.isArray(list)) {
          skillsSnapshot = list;
          setSkills(list);
        }
      } catch {
        /* 沿用内存快照 */
      }
    }

    // 检查是否命中技能 (内置或用户自定义，例如: /code-review 或 /my-skill)
    let activeSkill: SkillItem | null = null;
    let actualUserPrompt = text;

    const skillMatch = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (skillMatch) {
      const candidateId = skillMatch[1].toLowerCase();
      const found = skillsSnapshot.find(s => s.id.toLowerCase() === candidateId || s.name.toLowerCase() === candidateId);
      if (found) {
        activeSkill = found;
        actualUserPrompt = (skillMatch[2] || '').trim() || `请按照【${found.name}】技能规范执行任务。`;
      }
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      images: images.map(img => img.base64),
      timestamp: Date.now()
    };
    addMessageToCurrentSession(userMsg);

    let unsubscribeStream: (() => void) | null = null;
    let sendStartTime = Date.now();
    let streamFinishReason = '';

    try {
      // 查找当前所选模型归属的提供方及模型专属配置
      const matchedModel = allModels.find(m => m.value.toLowerCase() === selectedModel.toLowerCase());
      const providerId = matchedModel?.providerId || 'openai';
      const provider = providers.find(p => p.id === providerId) || providers[0];

      // 获取请求配置 (模型专属配置优先)
      const effectiveProtocol = matchedModel?.protocol || provider.protocol || 'openai';
      let effectiveBaseUrl = (matchedModel?.baseUrl || provider.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
      const effectiveApiKey = (matchedModel?.apiKey || provider.apiKey || '').trim();

      // 构建请求上下文 (若装载了技能，将技能完整工作流作为最高优先级 System Prompt 注入)
      const contextMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];

      if (activeSkill) {
        contextMessages.push({
          role: 'system',
          content: `【CODEX 技能已激活: ${activeSkill.name}】\n技能描述: ${activeSkill.description}\n\n=== 技能执行原则与规范 (SKILL.md) ===\n${activeSkill.prompt || activeSkill.content || ''}\n\n请严格按照上述技能的标准和步骤执行。`
        });
      }

      // 2. 注入当前会话工作区与安全权限规范 (以当前会话 currentSession.workspaceDir 为绝对准则)
      const sessionWorkspaceDir = currentSession.workspaceDir;
      let workspaceSystemPrompt = '';

      if (permissionMode === 'chat-only' || !sessionWorkspaceDir) {
        // 未绑定工作区或纯对话咨询模式：绝不注入任何工作区物理代码大纲，确保纯净独立
        workspaceSystemPrompt = `【当前运行环境: 🛡️ 通用独立对话模式】\n` +
          `- 隔离原则: 当前会话为独立通用对话，未绑定任何本地工程，已完全隔离本地物理代码大纲。\n` +
          `- 行为规约: 请专注于解答通用技术构想、架构设计或代码实现方案，无需假定或读取特定工程目录。`;
      } else {
        // 绑定了明确工作区的会话：严格针对 sessionWorkspaceDir 扫描大纲与注入根目录
        let treeOutline = '';
        if (window.codexDesktop?.readWorkspaceTree) {
          try {
            const treeRes = await window.codexDesktop.readWorkspaceTree(sessionWorkspaceDir);
            if (treeRes && treeRes.tree) {
              const nodes: string[] = [];
              const walk = (items: any[], indent = '') => {
                for (const it of items) {
                  if (nodes.length >= 120) break;
                  nodes.push(`${indent}- ${it.name}${it.isDirectory ? '/' : ''}`);
                  if (it.children) walk(it.children, indent + '  ');
                }
              };
              walk(treeRes.tree);
              treeOutline = nodes.join('\n');
              if (treeRes.totalCount && treeRes.totalCount > 120) {
                treeOutline += `\n... [工程规模较大，共计 ${treeRes.totalCount} 项，已略去后续条目，可调用 read_workspace_file 读取具体文件，或使用 @ 引用]`;
              }
            }
          } catch (e) {
            // 容错保持空白
          }
        }

        let modeTitle = '📖 工作区只读模式 (Workspace Read-Only)';
        let modeRule =
          '你当前处于工作区只读安全沙箱。工作区大纲只供定位路径，不是文件正文。需要查看文件时调用工具 `read_workspace_file`（参数 relativePath，相对工作区根目录），结果会回到本轮对话。禁止声称“无法读取文件”，也禁止只输出“让我读取...”后结束而不调用工具。用户本轮已用 @ 挂载的文件已在消息中，不必再读同一路径。\n' +
          '【工具边界】禁止调用 `write_workspace_file` 及任何本地写盘标记（filepath / @@@write_file）。若会话已挂载 MCP 连接器工具（名称以 `mcp__` 开头），仅可用于远程只读检索/查询，不得据此改写本地工程文件。';
        if (permissionMode === 'workspace-readwrite') {
          modeTitle = '✍️ 工作区读写模式 (Workspace Read/Write - 自动修改工程落盘)';
          modeRule = '【核心直写架构认知】你正运行在 Codex Desktop 工业级桌面端中，当前环境已直接授权你修改本地工程文件！客户端内置代码与文档自动落盘引擎，只要你在代码块第一行清晰标注 `// filepath: <相对路径>`（如 `// filepath: src/App.tsx`、`# filepath: config.py`、或 Markdown 文档 `<!-- filepath: docs/架构报告.md -->`），客户端在生成结束时将全自动直接修改并写入本地物理磁盘，并联动刷新左侧文件树与抽屉。\n' +
            '【输出纯粹性规约】客户端界面已自动为带 filepath 的代码块呈现完整的目标文件名与落盘状态，绝对严禁在代码块外部输出“已写入工作区xxx”、“若工作区没有请手动保存为同名文件”等自我推诿的套话和废话！直接输出分析正文和带 filepath 的代码块即可。\n' +
            '【文档与长文本产出规约】当用户要求生成文档、审查报告、设计方案、测试用例或 PRD 等长篇交付物时，必须将完整正文放入**同一个**带 filepath 的 Markdown 代码块（如 ````markdown\n<!-- filepath: docs/REPORT.md -->\n# 全文...\n````）；对话区仅保留 2~3 句摘要。严禁拆成「第1部分/第2部分」、多个不同路径或半截后说“未完待续”。若单次输出长度不够，后续续写必须复用**完全相同**的 filepath，客户端会自动拼接为同一文件。\n' +
            '【工具读盘】需要查看尚未挂载的文件时，先调用 `read_workspace_file`（参数 relativePath）。用户本轮已用 @ 挂载的同一路径不必重复读取。超限会截断并注明，截断提示表示这不是全文。\n' +
            '【工具写盘（推荐）】你可以使用工具 `write_workspace_file`（参数 relativePath + content）直接写入工作区完整文件；也可使用标记块：\n@@@write_file path="docs/a.md"\n全文\n@@@end\n优先工具/标记写完整文件，比多个残缺代码块更可靠。\n' +
            '【工程目录洁癖规约】严禁在工程根目录下随地创建临时测试或排查脚本！生成的诊断或排查脚本必须收纳在 `scripts/` 目录下（如 `scripts/diagnose-target.ps1`），技术文档必须收纳在 `docs/` 目录下，严禁污染工程根目录。\n' +
            '【绝对红线规约】绝对严禁向用户声称“我无法直接写文件”、“没有直接往磁盘写文件的通道”或“落盘必须你手动操作”，绝对严禁要求用户手动复制粘贴或保存文件！直接输出带 filepath 的完整内容即可，输出即代表直接落地！';
        } else if (permissionMode === 'full-access') {
          modeTitle = '🌐 全局受信任模式 (Full Access)';
          modeRule = '你拥有全局代码与文档直接修改落盘权限。查看尚未挂载的文件时先调用 read_workspace_file（参数 relativePath）；用户本轮已用 @ 挂载的同一路径不必重复读取。优先调用工具 write_workspace_file，或使用 @@@write_file 标记，或带 filepath 的代码块。长篇文档必须使用同一路径；禁止拆成多个残缺文件。临时脚本收纳在 scripts/，文档收纳在 docs/。严禁输出“若未落盘请手动保存”等推诿废话。';
        }

        workspaceSystemPrompt = `【当前工作区工程环境与安全运行权限】\n` +
          `- 本地工作区工程名称: ${currentSession.workspaceName || '当前工程'}\n` +
          `- 本地工作区绝对根目录: ${sessionWorkspaceDir}\n` +
          `- 运行权限等级: ${modeTitle}\n` +
          `- 核心准则: ${modeRule}\n` +
          (treeOutline ? `- 当前工程核心结构大纲:\n${treeOutline}\n` : '');
      }

      if (workspaceSystemPrompt) {
        contextMessages.push({
          role: 'system',
          content: workspaceSystemPrompt
        });
      }

      // 清洗并加载历史消息 (过滤空 content、截断占位符与历史推诿狡辩话术，阻断大模型多轮推理自洽抬杠链)
      (currentSession.messages || [])
        .slice(-10)
        .filter(m => m.content && typeof m.content === 'string' && m.content.trim().length > 0)
        .forEach(m => {
          let cleanedContent = m.content.trim();
          if (m.role === 'assistant') {
            // 清洗阶段 1: 过滤等待交互的截断词
            cleanedContent = cleanedContent.replace(/(?:让我读取.*?[：:]|先从.*?开始[：:])\s*$/g, '').trim();
            // 清洗：历史「输出提前结束」UI 提示不得进入模型上下文
            cleanedContent = cleanedContent.replace(EARLY_END_NOTE_RE, '').trim();
            cleanedContent = cleanedContent
              .split('\n')
              .filter((line) => !line.includes(EARLY_END_MARKER))
              .join('\n')
              .trim();
            // 清洗阶段 2: 过滤大模型历史中“无法写文件/需用户手动操作”的推诿话术，彻底阻断抬杠自洽链
            cleanedContent = cleanedContent
              .replace(/(?:直说[：:]\s*不能[^\n]*\n?)/gi, '')
              .replace(/(?:我没有直接往你磁盘写文件的通道[^\n]*\n?)/gi, '')
              .replace(/(?:落盘那一下[，,]?\s*永远需要你动手[^\n]*\n?)/gi, '')
              .replace(/(?:这是环境的安全设计[，,]?\s*不是代码没写好[^\n]*\n?)/gi, '')
              .replace(/(?:你在我消息里的代码块上[，,]?\s*看得到[“"']?写入.*?这类按钮吗[^\n]*\n?)/gi, '')
              .replace(/(?:若本轮落盘未触发[^\n]*\n?)/gi, '')
              .replace(/(?:请将该代码块手动保存[^\n]*\n?)/gi, '')
              .replace(/(?:请手动将[^\n]*保存到[^\n]*\n?)/gi, '')
              .replace(/(?:(?:已写入工作区|已存入本地|落盘完成|代码已写入)[^\n]*?(?:若工作区没有|若未自动落盘|把下方代码块手动存为|请手动|若未触发)[^\n]*[：:]?\s*)/gi, '')
              .replace(/(?:\(若工作区没有[^\n]*\)[：:]?\s*)/gi, '')
              .trim();
          }
          if (cleanedContent) {
            contextMessages.push({
              role: m.role,
              content: cleanedContent
            });
          }
        });

      // 3. 智能关联工作区文件内容 (@引用文件或工程分析/进度评估请求)
      let finalUserContent = actualUserPrompt;
      const atFileMatches = extractAtFileRefs(actualUserPrompt);
      const isAnalyzingWorkspace = /(分析|评估|看|梳理|走读|做到|进度|现状|架构).*(文件夹|工程|项目|代码|哪一步|模块|系统)/i.test(actualUserPrompt) ||
        /(项目|工程|代码).*(怎么样|到哪|进展)/i.test(actualUserPrompt);
      const filesToRead = new Set(atFileMatches);

      if (isAnalyzingWorkspace && filesToRead.size === 0 && activeWorkspaceDir) {
        // 自动探测工程关键配置与入口文件（前几个有效文件自动切片挂载）
        const candidateEntries = [
          'package.json', 'README.md', 'main.js', 'src/App.tsx', 'src/main.tsx',
          'src/index.ts', 'src/index.tsx', 'src/App.vue', 'Cargo.toml', 'go.mod'
        ];
        for (const candidate of candidateEntries) {
          filesToRead.add(candidate);
        }
      }

      if (filesToRead.size > 0 && window.codexDesktop?.readWorkspaceFile) {
        const attachedContents: string[] = [];
        let attachedCount = 0;
        for (const rel of filesToRead) {
          if (attachedCount >= 5) break; // 最多挂载 5 个关键入口文件，防止超长
          const blockedOffice = indirectOfficeHint(rel);
          if (blockedOffice) {
            attachedContents.push(blockedOffice);
            attachedCount++;
            continue;
          }
          try {
            const fileRes = await window.codexDesktop.readWorkspaceFile(rel);
            if (fileRes.ok && fileRes.content) {
              const label = /\.(docx|pdf)$/i.test(rel)
                ? `【文件挂载: ${rel}（已抽取正文）】`
                : `【文件挂载: ${rel}】`;
              attachedContents.push(`${label}\n\`\`\`\n${fileRes.content}\n\`\`\``);
              attachedCount++;
            } else if (!fileRes.ok) {
              attachedContents.push(`【文件读取失败: ${rel}】${fileRes.reason || fileRes.code || '未知错误'}`);
              attachedCount++;
            }
          } catch (e: any) {
            attachedContents.push(`【文件读取失败: ${rel}】${e?.message || '读取异常'}`);
            attachedCount++;
          }
        }
        if (attachedContents.length > 0) {
          finalUserContent = `${actualUserPrompt}\n\n=== 上下文关联文件内容 ===\n${attachedContents.join('\n\n')}`;
        }
      }

      contextMessages.push({ role: 'user', content: finalUserContent });

      // 统计输入字符与估算输入 Token 规模
      const totalInputChars = contextMessages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
      const estimatedInputTokens = Math.max(1, Math.round(totalInputChars / 2.5));
      sendStartTime = Date.now();
      let firstTokenTime: number | null = null;
      let accumulatedChars = 0;

      // 状态栏立即进入流式就绪计时
      setGenerationMetrics({
        isGenerating: true,
        firstTokenLatencyMs: null,
        speedTokPerSec: null,
        cacheHitPercent: null,
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
      });

      let response: { content?: string; thinking?: string; toolCall?: any } | null = null;
      const streamId = 'stream_' + Date.now();
      activeStreamIdRef.current = streamId;
      let collectedToolCalls: CodexToolCall[] = [];
      let streamedContentAcc = '';

      // 先在会话中追加占位的 Assistant 消息，随着流式接收实时增量填充
      const initialThinking = activeSkill ? `🧠 技能【${activeSkill.name}】已激活，正在思考...` : '正在思考与组织回复...';
      const placeholderAssistant: ChatMessage = {
        role: 'assistant',
        model: selectedModel,
        thinking: initialThinking,
        content: '',
        timestamp: Date.now()
      };
      addMessageToCurrentSession(placeholderAssistant);

      if (window.codexDesktop?.onLlmStreamChunk) {
        unsubscribeStream = window.codexDesktop.onLlmStreamChunk((data) => {
          if (data.streamId === streamId) {
            const delta = (data.contentDelta || '') + (data.thinkingDelta || '');
            if (delta.length > 0) {
              if (!firstTokenTime) {
                firstTokenTime = Date.now();
                const ttft = firstTokenTime - sendStartTime;
                setGenerationMetrics(prev => ({
                  ...prev,
                  isGenerating: true,
                  firstTokenLatencyMs: ttft,
                }));
              }
              accumulatedChars += delta.length;
              const estOutputTokens = Math.max(1, Math.round(accumulatedChars / 2.2));
              const durationSec = Math.max(0.1, (Date.now() - (firstTokenTime || sendStartTime)) / 1000);
              const tps = Math.round(estOutputTokens / durationSec);

              setGenerationMetrics(prev => ({
                ...prev,
                isGenerating: true,
                outputTokens: estOutputTokens,
                speedTokPerSec: tps,
              }));
            }

            if (data.contentDelta || data.thinkingDelta) {
              if (data.contentDelta) streamedContentAcc += data.contentDelta;
              updateLastMessageInCurrentSession(prev => ({
                ...prev,
                content: (prev.content || '') + (data.contentDelta || ''),
                thinking: data.thinkingDelta ? (prev.thinking || '') + data.thinkingDelta : prev.thinking
              }));
            }

            if (data.isDone) {
              if (data.finishReason) streamFinishReason = String(data.finishReason);
              if (Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
                collectedToolCalls = data.toolCalls
                  .filter((t: any) => t && t.name)
                  .map((t: any) => ({
                    id: t.id,
                    name: t.name,
                    arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments || {}),
                  }));
              }
            }
          }
        });
      }

      const canUseWriteTools =
        permissionMode === 'workspace-readwrite' || permissionMode === 'full-access';
      const canUseReadTools = permissionMode !== 'chat-only';

      let mcpToolsOpenAI: ReturnType<typeof connectorToolsToOpenAI> = [];
      let mcpToolsAnthropic: ReturnType<typeof connectorToolsToAnthropic> = [];
      if (window.codexDesktop?.listConnectorTools) {
        try {
          const listed = await window.codexDesktop.listConnectorTools();
          if (listed?.ok && Array.isArray(listed.tools)) {
            mcpToolsOpenAI = connectorToolsToOpenAI(listed.tools);
            mcpToolsAnthropic = connectorToolsToAnthropic(listed.tools);
          }
        } catch (e) {
          console.warn('加载连接器工具失败:', e);
        }
      }

      if (window.codexDesktop && window.codexDesktop.callLlmApi) {
        let endpoint = effectiveBaseUrl;
        let body: any = {};

        // 长文档完整落盘：默认 16384；若模型配置了 maxTokens 则采用（夹在 4096~128000）
        const modelCfg = provider.modelConfigs?.find(
          (c) => c.name.toLowerCase() === selectedModel.toLowerCase()
        );
        const effectiveMaxTokens = Math.max(
          4096,
          Math.min(128000, typeof modelCfg?.maxTokens === 'number' && modelCfg.maxTokens > 0 ? modelCfg.maxTokens : 16384)
        );

        if (effectiveProtocol === 'anthropic') {
          if (!endpoint.endsWith('/messages')) endpoint += '/v1/messages';
          const systemPrompts = contextMessages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
          const aTools = [
            ...localWorkspaceToolsAnthropic(canUseReadTools, canUseWriteTools),
            ...mcpToolsAnthropic,
          ];
          body = {
            model: selectedModel,
            max_tokens: effectiveMaxTokens,
            stream: true,
            messages: contextMessages.filter(m => m.role !== 'system'),
            system: systemPrompts || undefined,
            ...(aTools.length ? { tools: aTools } : {})
          };
        } else if (effectiveProtocol === 'ollama') {
          if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/api/chat')) {
            endpoint += '/v1/chat/completions';
          }
          const oTools = [
            ...localWorkspaceToolsOpenAI(canUseReadTools, canUseWriteTools),
            ...mcpToolsOpenAI,
          ];
          body = {
            model: selectedModel,
            stream: true,
            max_tokens: effectiveMaxTokens,
            messages: contextMessages,
            ...(oTools.length ? { tools: oTools, tool_choice: 'auto' } : {})
          };
        } else {
          // OpenAI 兼容协议 (支持 DeepSeek, GLM, OpenAI 等)
          if (!endpoint.endsWith('/chat/completions')) {
            endpoint += '/chat/completions';
          }
          const oTools = [
            ...localWorkspaceToolsOpenAI(canUseReadTools, canUseWriteTools),
            ...mcpToolsOpenAI,
          ];
          body = {
            model: selectedModel,
            stream: true,
            max_tokens: effectiveMaxTokens,
            messages: contextMessages,
            ...(oTools.length ? { tools: oTools, tool_choice: 'auto' } : {})
          };
        }

        const rawRes: any = await window.codexDesktop.callLlmApi({
          endpoint,
          apiKey: effectiveApiKey,
          body,
          stream: true,
          streamId,
          timeout: matchedModel?.timeoutSeconds
        });

        if (rawRes && rawRes.ok) {
          const parsed = typeof rawRes.body === 'string' ? JSON.parse(rawRes.body) : rawRes.body;

          // 提取真实 usage 指标并计算最终结算速率
          const usage = parsed?.usage;
          const realInputTokens = usage?.prompt_tokens ?? estimatedInputTokens;
          const realOutputTokens = usage?.completion_tokens ?? Math.max(1, Math.round(accumulatedChars / 2.2));
          const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? null;
          const cacheHit = cachedTokens && realInputTokens > 0 ? Math.round((cachedTokens / realInputTokens) * 100) : null;
          const finalDurationSec = Math.max(0.1, (Date.now() - (firstTokenTime || sendStartTime)) / 1000);
          const finalTps = Math.round(realOutputTokens / finalDurationSec);

          setGenerationMetrics({
            isGenerating: false,
            firstTokenLatencyMs: firstTokenTime ? firstTokenTime - sendStartTime : null,
            speedTokPerSec: finalTps,
            cacheHitPercent: cacheHit,
            inputTokens: realInputTokens,
            outputTokens: realOutputTokens,
          });

          if (effectiveProtocol === 'anthropic') {
            const text = (parsed.content || []).map((c: any) => c.text || '').join('');
            const thinking = (parsed.content || []).filter((c: any) => c.type === 'thinking').map((c: any) => c.thinking).join('\n');
            response = { content: text, thinking };
            const anthropicTools = (parsed.content || [])
              .filter((c: any) => c.type === 'tool_use' && c.name)
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {}),
              }));
            if (anthropicTools.length) collectedToolCalls = anthropicTools;
          } else {
            const choice = parsed.choices?.[0];
            const text = choice?.message?.content || parsed.message?.content || parsed.response || '';
            const thinking = choice?.message?.reasoning_content || choice?.message?.reasoning || '';
            response = { content: text, thinking };
            if (choice?.finish_reason) streamFinishReason = String(choice.finish_reason);
            else if (parsed.finish_reason) streamFinishReason = String(parsed.finish_reason);
            if (Array.isArray(parsed.codex_tool_calls) && parsed.codex_tool_calls.length) {
              collectedToolCalls = parsed.codex_tool_calls;
            } else if (Array.isArray(choice?.message?.tool_calls)) {
              collectedToolCalls = choice.message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function?.name || tc.name,
                arguments: tc.function?.arguments || '{}',
              }));
            }
          }

          // Anthropic 顶层 stop_reason
          if (effectiveProtocol === 'anthropic' && parsed.stop_reason) {
            streamFinishReason = String(parsed.stop_reason);
          }

          // 工具调用常只回 tool_calls、正文为空。此时不要写成鉴权失败，等工具续跑后再显示正文或执行结果。
          const hasPendingAgentTools = collectedToolCalls.some((t) => isAgentToolName(t.name));
          const emptyReplyFallback = hasPendingAgentTools
            ? ''
            : '⚠️ 未收到模型正文。接口已返回，但这轮没有可显示的文本，不是 API Key 错误。';
          updateLastMessageInCurrentSession(prev => ({
            ...prev,
            content: prev.content || response?.content || emptyReplyFallback,
            thinking: response?.thinking || prev.thinking || (hasPendingAgentTools ? '正在执行工具...' : '任务思考已完成。')
          }));

          // 读盘 / 写盘 / MCP：执行工具 + @@@write_file 标记兜底 + 有限多轮续跑
          {
            const toolResults: string[] = [];
            let lastApiToolCalls = collectedToolCalls.filter((t) => isAgentToolName(t.name));
            let lastAssistantText = streamedContentAcc || response?.content || '';
            let roundMessages: any[] = [...contextMessages];
            let toolRound = 0;

            if (lastApiToolCalls.length > 0) {
              // 补全 tool call id，供后续 role=tool 关联
              lastApiToolCalls = lastApiToolCalls.map((tc, i) => ({
                ...tc,
                id: tc.id || `call_${Date.now()}_${i}`,
              }));
              const exec1 = await executeAgentTools(lastApiToolCalls, handleFileWritten);
              toolResults.push(...exec1.lines);
              let results = exec1.results;

              while (
                lastApiToolCalls.length > 0 &&
                toolRound < MAX_WRITE_TOOL_ROUNDS - 1 &&
                activeStreamIdRef.current
              ) {
                toolRound += 1;

                if (effectiveProtocol === 'anthropic') {
                  const assistantContent: any[] = [];
                  if (lastAssistantText.trim()) {
                    assistantContent.push({ type: 'text', text: lastAssistantText });
                  }
                  for (const tc of lastApiToolCalls) {
                    let input: any = {};
                    try { input = JSON.parse(tc.arguments || '{}'); } catch { input = {}; }
                    assistantContent.push({
                      type: 'tool_use',
                      id: tc.id,
                      name: tc.name,
                      input,
                    });
                  }
                  roundMessages = [
                    ...roundMessages,
                    { role: 'assistant', content: assistantContent },
                    {
                      role: 'user',
                      content: results.map((r) => ({
                        type: 'tool_result',
                        tool_use_id: r.id,
                        content: r.content,
                      })),
                    },
                  ];
                } else {
                  roundMessages = [
                    ...roundMessages,
                    {
                      role: 'assistant',
                      content: lastAssistantText || null,
                      tool_calls: lastApiToolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments || '{}' },
                      })),
                    },
                    ...results.map((r) => ({
                      role: 'tool',
                      tool_call_id: r.id,
                      content: r.content,
                    })),
                  ];
                }

                updateLastMessageInCurrentSession((prev) => ({
                  ...prev,
                  thinking: `${prev.thinking || ''}\n🔄 工具结果已回传，第 ${toolRound + 1} 轮续跑...`.trim(),
                }));

                const contStreamId = `${streamId}_tool${toolRound}`;
                activeStreamIdRef.current = contStreamId;
                let contContentAcc = '';
                let contToolCalls: CodexToolCall[] = [];

                if (unsubscribeStream) {
                  unsubscribeStream();
                  unsubscribeStream = null;
                }
                if (window.codexDesktop?.onLlmStreamChunk) {
                  unsubscribeStream = window.codexDesktop.onLlmStreamChunk((data) => {
                    if (data.streamId !== contStreamId) return;
                    if (data.contentDelta) {
                      contContentAcc += data.contentDelta;
                      updateLastMessageInCurrentSession((prev) => ({
                        ...prev,
                        content: (prev.content || '') + data.contentDelta,
                      }));
                    }
                    if (data.thinkingDelta) {
                      updateLastMessageInCurrentSession((prev) => ({
                        ...prev,
                        thinking: (prev.thinking || '') + data.thinkingDelta,
                      }));
                    }
                    if (data.isDone) {
                      if (data.finishReason) streamFinishReason = String(data.finishReason);
                      if (Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
                        contToolCalls = data.toolCalls
                          .filter((t: any) => t && t.name)
                          .map((t: any) => ({
                            id: t.id,
                            name: t.name,
                            arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments || {}),
                          }));
                      }
                    }
                  });
                }

                let contEndpoint = effectiveBaseUrl;
                let contBody: any = {};
                if (effectiveProtocol === 'anthropic') {
                  if (!contEndpoint.endsWith('/messages')) contEndpoint += '/v1/messages';
                  const systemPrompts = roundMessages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
                  const contATools = [
                    ...localWorkspaceToolsAnthropic(canUseReadTools, canUseWriteTools),
                    ...mcpToolsAnthropic,
                  ];
                  contBody = {
                    model: selectedModel,
                    max_tokens: effectiveMaxTokens,
                    stream: true,
                    messages: roundMessages.filter((m) => m.role !== 'system'),
                    system: systemPrompts || undefined,
                    ...(contATools.length ? { tools: contATools } : {}),
                  };
                } else {
                  if (effectiveProtocol === 'ollama') {
                    if (!contEndpoint.endsWith('/chat/completions') && !contEndpoint.endsWith('/api/chat')) {
                      contEndpoint += '/v1/chat/completions';
                    }
                  } else if (!contEndpoint.endsWith('/chat/completions')) {
                    contEndpoint += '/chat/completions';
                  }
                  const contOTools = [
                    ...localWorkspaceToolsOpenAI(canUseReadTools, canUseWriteTools),
                    ...mcpToolsOpenAI,
                  ];
                  contBody = {
                    model: selectedModel,
                    stream: true,
                    max_tokens: effectiveMaxTokens,
                    messages: roundMessages,
                    ...(contOTools.length ? { tools: contOTools, tool_choice: 'auto' } : {}),
                  };
                }

                const contRes: any = await window.codexDesktop.callLlmApi({
                  endpoint: contEndpoint,
                  apiKey: effectiveApiKey,
                  body: contBody,
                  stream: true,
                  streamId: contStreamId,
                  timeout: matchedModel?.timeoutSeconds,
                });

                if (!contRes?.ok) break;

                const contParsed = typeof contRes.body === 'string' ? JSON.parse(contRes.body) : contRes.body;
                if (effectiveProtocol === 'anthropic') {
                  const text = (contParsed.content || []).map((c: any) => c.text || '').join('');
                  if (!contContentAcc && text) {
                    contContentAcc = text;
                    updateLastMessageInCurrentSession((prev) => ({
                      ...prev,
                      content: `${prev.content || ''}${text}`,
                    }));
                  }
                  const anthropicTools = (contParsed.content || [])
                    .filter((c: any) => c.type === 'tool_use' && c.name)
                    .map((c: any) => ({
                      id: c.id,
                      name: c.name,
                      arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {}),
                    }));
                  if (anthropicTools.length) contToolCalls = anthropicTools;
                } else {
                  const choice = contParsed.choices?.[0];
                  const text = choice?.message?.content || '';
                  if (!contContentAcc && text) {
                    contContentAcc = text;
                    updateLastMessageInCurrentSession((prev) => ({
                      ...prev,
                      content: `${prev.content || ''}${text}`,
                    }));
                  }
                  if (Array.isArray(contParsed.codex_tool_calls) && contParsed.codex_tool_calls.length) {
                    contToolCalls = contParsed.codex_tool_calls;
                  } else if (Array.isArray(choice?.message?.tool_calls)) {
                    contToolCalls = choice.message.tool_calls.map((tc: any) => ({
                      id: tc.id,
                      name: tc.function?.name || tc.name,
                      arguments: tc.function?.arguments || '{}',
                    }));
                  }
                }

                lastAssistantText = contContentAcc;
                lastApiToolCalls = contToolCalls
                  .filter((t) => isAgentToolName(t.name))
                  .map((tc, i) => ({ ...tc, id: tc.id || `call_${Date.now()}_${toolRound}_${i}` }));

                if (lastApiToolCalls.length === 0) break;

                const next = await executeAgentTools(lastApiToolCalls, handleFileWritten);
                toolResults.push(...next.lines);
                results = next.results;
              }

              // 末轮收束：工具已执行但结果尚未回传模型时，再请求一次且不挂工具，避免停在「已读取」无终答
              if (lastApiToolCalls.length > 0 && results.length > 0 && activeStreamIdRef.current) {
                if (effectiveProtocol === 'anthropic') {
                  const assistantContent: any[] = [];
                  if (lastAssistantText.trim()) {
                    assistantContent.push({ type: 'text', text: lastAssistantText });
                  }
                  for (const tc of lastApiToolCalls) {
                    let input: any = {};
                    try { input = JSON.parse(tc.arguments || '{}'); } catch { input = {}; }
                    assistantContent.push({
                      type: 'tool_use',
                      id: tc.id,
                      name: tc.name,
                      input,
                    });
                  }
                  roundMessages = [
                    ...roundMessages,
                    { role: 'assistant', content: assistantContent },
                    {
                      role: 'user',
                      content: results.map((r) => ({
                        type: 'tool_result',
                        tool_use_id: r.id,
                        content: r.content,
                      })),
                    },
                  ];
                } else {
                  roundMessages = [
                    ...roundMessages,
                    {
                      role: 'assistant',
                      content: lastAssistantText || null,
                      tool_calls: lastApiToolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments || '{}' },
                      })),
                    },
                    ...results.map((r) => ({
                      role: 'tool',
                      tool_call_id: r.id,
                      content: r.content,
                    })),
                  ];
                }

                updateLastMessageInCurrentSession((prev) => ({
                  ...prev,
                  thinking: `${prev.thinking || ''}\n🔄 工具结果已回传，正在生成最终回复...`.trim(),
                }));

                const closeStreamId = `${streamId}_tool_close`;
                activeStreamIdRef.current = closeStreamId;
                let closeContentAcc = '';
                if (unsubscribeStream) {
                  unsubscribeStream();
                  unsubscribeStream = null;
                }
                if (window.codexDesktop?.onLlmStreamChunk) {
                  unsubscribeStream = window.codexDesktop.onLlmStreamChunk((data) => {
                    if (data.streamId !== closeStreamId) return;
                    if (data.contentDelta) {
                      closeContentAcc += data.contentDelta;
                      updateLastMessageInCurrentSession((prev) => ({
                        ...prev,
                        content: (prev.content || '') + data.contentDelta,
                      }));
                    }
                    if (data.thinkingDelta) {
                      updateLastMessageInCurrentSession((prev) => ({
                        ...prev,
                        thinking: (prev.thinking || '') + data.thinkingDelta,
                      }));
                    }
                    if (data.isDone && data.finishReason) {
                      streamFinishReason = String(data.finishReason);
                    }
                  });
                }

                let closeEndpoint = effectiveBaseUrl;
                let closeBody: any = {};
                if (effectiveProtocol === 'anthropic') {
                  if (!closeEndpoint.endsWith('/messages')) closeEndpoint += '/v1/messages';
                  const systemPrompts = roundMessages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
                  closeBody = {
                    model: selectedModel,
                    max_tokens: effectiveMaxTokens,
                    stream: true,
                    messages: roundMessages.filter((m) => m.role !== 'system'),
                    system: systemPrompts || undefined,
                  };
                } else {
                  if (effectiveProtocol === 'ollama') {
                    if (!closeEndpoint.endsWith('/chat/completions') && !closeEndpoint.endsWith('/api/chat')) {
                      closeEndpoint += '/v1/chat/completions';
                    }
                  } else if (!closeEndpoint.endsWith('/chat/completions')) {
                    closeEndpoint += '/chat/completions';
                  }
                  closeBody = {
                    model: selectedModel,
                    stream: true,
                    max_tokens: effectiveMaxTokens,
                    messages: roundMessages,
                  };
                }

                const closeRes: any = await window.codexDesktop.callLlmApi({
                  endpoint: closeEndpoint,
                  apiKey: effectiveApiKey,
                  body: closeBody,
                  stream: true,
                  streamId: closeStreamId,
                  timeout: matchedModel?.timeoutSeconds,
                });

                if (closeRes?.ok) {
                  try {
                    const closeParsed = typeof closeRes.body === 'string' ? JSON.parse(closeRes.body) : closeRes.body;
                    if (effectiveProtocol === 'anthropic') {
                      const text = (closeParsed.content || []).map((c: any) => c.text || '').join('');
                      if (!closeContentAcc && text) {
                        updateLastMessageInCurrentSession((prev) => ({
                          ...prev,
                          content: `${prev.content || ''}${text}`,
                        }));
                      }
                      if (closeParsed.stop_reason) streamFinishReason = String(closeParsed.stop_reason);
                    } else {
                      const choice = closeParsed.choices?.[0];
                      const text = choice?.message?.content || '';
                      if (!closeContentAcc && text) {
                        updateLastMessageInCurrentSession((prev) => ({
                          ...prev,
                          content: `${prev.content || ''}${text}`,
                        }));
                      }
                      if (choice?.finish_reason) streamFinishReason = String(choice.finish_reason);
                    }
                  } catch {
                    /* 流式已增量写入 */
                  }
                  lastApiToolCalls = [];
                }
              }
            }

            if (canUseWriteTools) {
              const textForTags = streamedContentAcc || response?.content || '';
              const tagged = extractTaggedWriteFiles(textForTags);
              if (tagged.length > 0) {
                const asTools: CodexToolCall[] = tagged.map((t, i) => ({
                  id: `tag_${i}`,
                  name: 'write_workspace_file',
                  arguments: JSON.stringify({ relativePath: t.relativePath, content: t.content }),
                }));
                const { lines } = await executeWriteWorkspaceTools(asTools, handleFileWritten);
                toolResults.push(...lines);
                updateLastMessageInCurrentSession((prev) => ({
                  ...prev,
                  content: (prev.content || '')
                    .replace(/@@@write_file\s+path=["'][^"']+["']\s*\r?\n[\s\S]*?@@@end/gi, '')
                    .trim(),
                }));
              }
            }

            if (toolResults.length > 0) {
              updateLastMessageInCurrentSession((prev) => ({
                ...prev,
                content: `${prev.content || ''}\n\n---\n**🔧 工具执行结果**\n${toolResults.join('\n')}`.trim(),
              }));
            }

            // 正常关流但疑似截断：只打 earlyEnded 标记，文案在 UI 展示，避免污染后续上下文
            updateLastMessageInCurrentSession((prev) => {
              const body = (prev.content || '').replace(EARLY_END_NOTE_RE, '').trim();
              const toolsExhaustedIncomplete = lastApiToolCalls.length > 0;
              const early =
                toolsExhaustedIncomplete || looksLikeEarlyEnd(body, streamFinishReason);
              return {
                ...prev,
                content: body,
                earlyEnded: early || Boolean(prev.earlyEnded),
              };
            });
          }
        } else {
          let errText = rawRes?.body;
          if (typeof errText === 'object') errText = JSON.stringify(errText);
          throw new Error(errText || rawRes?.statusText || `HTTP ${rawRes?.status || 500}`);
        }
      }
    } catch (err: any) {
      let rawMsg = err.message || '网络连接超时或提供方异常';
      let friendlyError = rawMsg;

      try {
        const parsed = JSON.parse(rawMsg);
        const innerMsg = parsed?.error?.message || parsed?.message || parsed?.error;
        if (typeof innerMsg === 'string') {
          friendlyError = innerMsg;
        }
      } catch {
        // 保持原样
      }

      if (friendlyError.includes('ECONNRESET')) {
        friendlyError = '网络连接被服务商/代理强行重置 (read ECONNRESET)。已自动重试 2 次仍未连通，通常为模型服务商网关抖动或网络代理切断，建议稍后重试。';
      } else if (friendlyError.includes('ETIMEDOUT') || friendlyError.includes('Request Timeout') || friendlyError.includes('首包响应等待超时')) {
        friendlyError = '模型服务商响应超时，当前排队或模型负荷过高，请检查网络或稍后重试。';
      } else if (friendlyError.includes('socket hang up')) {
        friendlyError = '网络连接被意外挂断 (socket hang up)，请检查模型服务商或中转站稳定性。';
      } else if (
        friendlyError.includes('unexpected EOF') ||
        friendlyError.includes('stream reading error') ||
        friendlyError.includes('STREAM_EOF') ||
        friendlyError.includes('Stream EOF')
      ) {
        friendlyError = '流式传输中途被对端关闭 (unexpected EOF)，通常由中转站/Nginx 的连接超时或反向代理过早断流所致。若已有部分内容输出则已截断保留，可重新发送请求。';
      } else if (friendlyError.includes('aborted')) {
        friendlyError = '请求被中断 (aborted)，可能是网络环境不稳定或服务端主动中止，请检查代理设置后重试。';
      }

      updateLastMessageInCurrentSession(prev => ({
        ...prev,
        content: prev.content
          ? `${prev.content}\n\n❌ [传输中断]: ${friendlyError}`
          : `❌ 请求失败: ${friendlyError}`,
        thinking: '执行异常',
      }));
    } finally {
      const workDurationSec = Math.max(1, Math.round((Date.now() - sendStartTime) / 1000));
      updateLastMessageInCurrentSession((prev) => ({
        ...prev,
        workDurationSec: prev.workDurationSec || workDurationSec,
      }));
      activeStreamIdRef.current = null;
      if (unsubscribeStream) {
        unsubscribeStream();
      }
      setIsGenerating(false);
      setGenerationMetrics(prev => ({
        ...prev,
        isGenerating: false
      }));
    }
  };

  const handleContinueGeneration = () => {
    if (isGenerating) return;
    handleSend(CONTINUE_PROMPT, []);
  };

  // 主动停止当前正在流式生成的任务并切断网络连接
  const handleStopGeneration = async () => {
    const currentStreamId = activeStreamIdRef.current;
    if (currentStreamId && window.codexDesktop?.abortLlmStream) {
      try {
        await window.codexDesktop.abortLlmStream(currentStreamId);
      } catch (err) {
        console.warn('中断 LLM 连接请求异常:', err);
      }
    }
    activeStreamIdRef.current = null;
    setIsGenerating(false);
    setGenerationMetrics(prev => ({
      ...prev,
      isGenerating: false,
    }));
    updateLastMessageInCurrentSession(prev => ({
      ...prev,
      content: prev.content
        ? `${prev.content}\n\n⏹️ *[用户已主动停止生成]*`
        : '⏹️ *[用户已主动停止生成]*',
      thinking: '已主动停止'
    }));
  };

  // 撤回指定消息并回填到输入框供用户修改重发
  const handleRevokeMessage = (messageIndex: number) => {
    if (isGenerating) {
      handleStopGeneration();
    }
    const revoked = rollbackMessage(messageIndex);
    if (revoked && revoked.content) {
      setInputPrompt(revoked.content);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base text-text-primary">
      {/* 工作台三栏骨架 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧一体化侧边栏 (DSH 风格工作区树 + 会话分叉归档) */}
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={() => {
            const wsDir = currentSession?.workspaceDir || activeWorkspaceDir || undefined;
            const wsName = currentSession?.workspaceName || (wsDir ? wsDir.replace(/[\\/]$/, '').split(/[\\/]/).pop() : undefined);
            createNewSession(selectedModel, wsDir, wsName);
          }}
          onNewSessionInWorkspace={(wsDir, wsName) => createNewSession(selectedModel, wsDir, wsName)}
          onForkSession={forkSession}
          onArchiveSession={toggleArchiveSession}
          onMoveSessionToWorkspace={moveSessionToWorkspace}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
          onInsertPrompt={(text) => setInputPrompt(prev => prev ? `${prev} ${text}` : text)}
          onSelectFile={handleSelectFile}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenTheme={() => setIsThemeOpen(true)}
          onOpenAbout={() => setIsAboutOpen(true)}
          onOpenFeedback={() => setIsFeedbackOpen(true)}
          activeWorkspaceDir={activeWorkspaceDir}
          onWorkspaceChange={handleWorkspaceChange}
          refreshTrigger={workspaceRefreshTrigger}
          skillsTabSignal={skillsTabSignal}
        />

        {/* 中间主工作台 */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-bg-base relative min-w-0">
          {/* Header */}
          <header className="h-12 border-b border-border px-5 flex items-center justify-between bg-bg-sidebar/40 select-none flex-shrink-0">
            <div className="flex items-center gap-2 text-xs truncate">
              <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold font-mono text-[11px]">
                Codex Agent
              </span>
              <span className="text-text-muted">/</span>
              <span className="text-text-primary font-bold truncate max-w-sm">
                {currentSession.title || '新会话'}
              </span>
              {currentSession.workspaceName ? (
                <button
                  type="button"
                  onClick={() => updateCurrentSessionWorkspace('', '')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent font-mono text-[10px] truncate max-w-[130px] hover:bg-accent/20 transition-colors cursor-pointer"
                  title={`当前会话已归属于工程: ${currentSession.workspaceDir}\n点击可移出工程（转为通用独立会话）`}
                >
                  <span>📁 {currentSession.workspaceName}</span>
                  <span className="text-[9px] text-accent/60 hover:text-accent font-bold">×</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (activeWorkspaceDir) {
                      const name = activeWorkspaceDir.replace(/[\\/]$/, '').split(/[\\/]/).pop() || '工程';
                      updateCurrentSessionWorkspace(activeWorkspaceDir, name);
                    }
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-500/10 border border-border text-text-muted font-mono text-[10px] hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
                  title={activeWorkspaceDir ? `点击将当前会话归入活跃工程: ${activeWorkspaceDir}` : '当前为纯净通用独立对话，未绑定任何工程'}
                >
                  💬 通用独立会话 {activeWorkspaceDir ? '+ 归入当前工程' : ''}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsConnectorsOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors"
                title="配置 MCP 连接器（标准大数据等）"
              >
                <Plug size={13} />
                <span>连接器</span>
              </button>
              <button
                onClick={exportCurrentSessionAsMarkdown}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors"
                title="导出当前会话为 Markdown 文档"
              >
                <Download size={13} />
                <span>导出 .md</span>
              </button>
              <button
                onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  isPreviewOpen
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                <Layers size={13} />
                <span>预览面板</span>
              </button>
            </div>
          </header>

          {/* 消息流视图 */}
          <ChatStream
            messages={currentSession.messages}
            isGenerating={isGenerating}
            currentModel={selectedModel}
            onOpenLightbox={(src) => setLightboxImg(src)}
            permissionMode={permissionMode}
            onFileWritten={handleFileWritten}
            onPermissionChange={handleSelectPermissionMode}
            onRevokeMessage={handleRevokeMessage}
            onOpenFileDiff={handleFileWritten}
            onRevertFile={handleRevertFile}
            onContinueGeneration={handleContinueGeneration}
          />

          {/* 底部 Composer 输入区 */}
          <Composer
            onSend={handleSend}
            onStopGeneration={handleStopGeneration}
            isGenerating={isGenerating}
            queue={queue}
            onRemoveQueueItem={removeQueueItem}
            allModels={allModels}
            selectedModel={selectedModel}
            onSelectModel={selectModel}
            inputPrompt={inputPrompt}
            setInputPrompt={setInputPrompt}
            skills={skills}
            permissionMode={permissionMode}
            onSelectPermissionMode={handleSelectPermissionMode}
            currentSessionId={currentSessionId}
          />
        </main>

        {/* 右侧变更预览面板 (支持源码/Diff双模式与一键还原) */}
        <PreviewPanel
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          title={previewFile?.title}
          filePath={previewFile?.filePath}
          codeContent={previewFile?.codeContent}
          originalContent={previewFile?.originalContent}
          hasBackup={previewFile?.hasBackup}
          onRevert={handleRevertFile}
          onInsertToPrompt={(text) => setInputPrompt(prev => prev ? `${prev} ${text}` : text)}
        />
      </div>

      {/* 底部极客状态栏 (100% 真实流式遥测指标) */}
      <StatusBar metrics={generationMetrics} />

      {/* 全局模态弹窗系统 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        providers={providers}
        onSaveProviders={saveProviders}
      />

      <ConnectorsModal
        isOpen={isConnectorsOpen}
        onClose={() => setIsConnectorsOpen(false)}
      />

      <ThemeModal
        isOpen={isThemeOpen}
        onClose={() => setIsThemeOpen(false)}
        currentTheme={theme}
        onSelectTheme={setTheme}
      />

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        onCheckUpdates={checkForUpdates}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
      />

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        selectedModel={selectedModel}
        permissionMode={permissionMode}
      />

      <UpdatePromptModal
        isOpen={isUpdateModalOpen}
        onClose={closeUpdateModal}
        updateInfo={updateInfo}
        isDownloading={isUpdateDownloading}
        progress={updateProgress}
        isDownloaded={isUpdateDownloaded}
        downloadedVersion={downloadedVersion}
        onStartDownload={startDownload}
      />

      <ImageLightbox
        src={lightboxImg}
        onClose={() => setLightboxImg(null)}
      />
    </div>
  );
};
