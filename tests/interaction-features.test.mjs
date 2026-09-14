import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';

/**
 * Seam 18: 主动打断流式生成与消息撤回修改状态机 TDD 测试套件
 */
export function runInteractionFeaturesTests() {
  process.stdout.write("\n═══ Seam 18: 主动打断流式生成与消息撤回修改状态机 ═══\n");

  const rootDir = process.cwd();

  function test(name, fn) {
    try {
      fn();
      process.stdout.write(`  ✅ [PASS] ${name}\n`);
    } catch (err) {
      process.stdout.write(`  ❌ [FAIL] ${name}\n`);
      process.stdout.write(`           → ${err.message}\n`);
      throw err;
    }
  }

  test("main.js: abort-llm-stream 管道与 activeLlmStreams 强行掐断连接机制完备", () => {
    const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
    assert.ok(mainJs.includes("abort-llm-stream"), "main.js 必须注册 abort-llm-stream IPC 处理器");
    assert.ok(mainJs.includes("activeLlmStreams"), "main.js 必须维护活跃请求映射表 activeLlmStreams");
    assert.ok(mainJs.includes("req.destroy()"), "main.js 必须具备物理掐断底层的 req.destroy 逻辑");
  });

  test("preload.js: 安全隔离桥梁暴露 abortLlmStream 接口", () => {
    const preloadJs = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
    assert.ok(preloadJs.includes("abortLlmStream:"), "preload.js 必须向渲染进程暴露 abortLlmStream 桥梁");
  });

  test("useSessions.ts: rollbackMessage 精准抹去该轮问答", () => {
    const sessionsHook = fs.readFileSync(path.join(rootDir, "src", "hooks", "useSessions.ts"), "utf8");
    assert.ok(sessionsHook.includes("rollbackMessage"), "useSessions 必须导出 rollbackMessage");
    assert.ok(sessionsHook.includes("splice(messageIndex"), "rollbackMessage 必须精准抹去该轮问答");
  });

  test("React 界面层: Composer 停止按钮与 ChatStream 撤回修改接线完备", () => {
    const appTsx = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    const composerTsx = fs.readFileSync(path.join(rootDir, "src", "components", "Composer", "Composer.tsx"), "utf8");
    const chatStreamTsx = fs.readFileSync(path.join(rootDir, "src", "components", "ChatStream", "ChatStream.tsx"), "utf8");
    assert.ok(appTsx.includes("handleStopGeneration"), "App.tsx 必须实现 handleStopGeneration");
    assert.ok(appTsx.includes("handleRevokeMessage"), "App.tsx 必须实现 handleRevokeMessage");
    assert.ok(composerTsx.includes("onStopGeneration"), "Composer 必须支持 onStopGeneration 回调");
    assert.ok(chatStreamTsx.includes("onRevokeMessage"), "ChatStream 必须支持 onRevokeMessage 回调");
    assert.ok(chatStreamTsx.includes("撤回修改"), "ChatStream 必须渲染撤回修改按钮");
  });

  test("React 界面层: Composer 支持文本/代码附件附加与发送拼装", () => {
    const composerTsx = fs.readFileSync(path.join(rootDir, "src", "components", "Composer", "Composer.tsx"), "utf8");
    assert.ok(composerTsx.includes("isTextAttachment"), "Composer 必须识别文本附件");
    assert.ok(composerTsx.includes("【附件文件:"), "发送时必须将文本附件拼入 prompt");
    assert.ok(composerTsx.includes("暂不支持"), "不支持的文件类型必须给出提示");
    assert.ok(composerTsx.includes("e.target.value = ''") || composerTsx.includes('e.target.value = ""'), "选完文件后必须清空 input 以便重复选择");
    assert.ok(composerTsx.includes("wrapAttachmentFence"), "附件内容必须用自适应 fence 包裹防打断");
    assert.ok(composerTsx.includes("hasNullByte"), "文本附件必须做 Null Byte 二进制嗅探");
    assert.ok(composerTsx.includes("isSensitiveAttachmentName"), "敏感文件名（如 .env）必须拦截");
    assert.ok(composerTsx.includes("extractDocxText"), "docx 附件必须抽取正文后再挂载");
    assert.ok(composerTsx.includes("setAttachHint(null)"), "附件提示必须可关闭");
    const extBlock = composerTsx.match(/TEXT_FILE_EXTS = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(extBlock, "必须定义 TEXT_FILE_EXTS");
    assert.ok(!extBlock[1].includes("'.env'") && !extBlock[1].includes('".env"'), "TEXT_FILE_EXTS 不得包含 .env");
  });

  test("长文完整落盘: max_tokens 抬升与同路径多块合并", () => {
    const appTsx = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    const mdTsx = fs.readFileSync(path.join(rootDir, "src", "components", "ChatStream", "MarkdownRenderer.tsx"), "utf8");
    assert.ok(appTsx.includes("effectiveMaxTokens"), "App 必须计算 effectiveMaxTokens");
    assert.ok(appTsx.includes("16384"), "默认 max_tokens 应为 16384");
    assert.ok(appTsx.includes("复用**完全相同**的 filepath") || appTsx.includes("完全相同"), "长文提示词须禁止拆分多文件");
    assert.ok(mdTsx.includes("function mergeFilesByPath"), "MarkdownRenderer 必须合并同 filepath 代码块");
    assert.ok(mdTsx.includes("mergedFiles"), "自动落盘必须使用合并后的文件列表");
  });

  test("消息导出: export-chat-artifact 与 ChatStream 导出入口", () => {
    const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
    const preload = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
    const chat = fs.readFileSync(path.join(rootDir, "src", "components", "ChatStream", "ChatStream.tsx"), "utf8");
    assert.ok(mainJs.includes('ipcMain.handle("export-chat-artifact"'), "main 必须提供 export-chat-artifact");
    assert.ok(mainJs.includes("buildOoxmlDocxBuffer"), "必须输出真正 OOXML .docx");
    assert.ok(mainJs.includes("markdownToOoxmlParagraphs"), "docx 须支持 Markdown 富文本段落");
    assert.ok(mainJs.includes("word/numbering.xml"), "docx 须含列表 numbering 部件");
    assert.ok(mainJs.includes("word/document.xml"), "docx 包须含 word/document.xml");
    assert.ok(mainJs.includes("printToPDF"), "必须支持 PDF 导出");
    assert.ok(preload.includes("exportChatArtifact:"), "preload 必须暴露 exportChatArtifact");
    assert.ok(chat.includes("handleExportMessage"), "ChatStream 必须有导出处理");
    assert.ok(chat.includes("Word (.docx)"), "ChatStream 导出菜单须为 .docx");
    assert.ok(chat.includes("导出为文件") || chat.includes("导出回答"), "ChatStream 必须有导出 UI");

    // 运行时：富文本 OOXML 须含列表 / 粗体 / 代码围栏 / numbering
    const start = mainJs.indexOf("function crc32Bytes");
    const end = mainJs.indexOf("function stripMarkdownToPlain");
    assert.ok(start >= 0 && end > start, "可抽取 OOXML 构建函数");
    const ctx = { Buffer, console };
    vm.createContext(ctx);
    vm.runInContext(mainJs.slice(start, end), ctx);
    const sample = [
      "# 标题一",
      "这是 **粗体** 与 `代码` 以及 *斜体*。",
      "- 无序甲",
      "- 无序乙",
      "1. 有序一",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    const buf = ctx.buildOoxmlDocxBuffer("富文本导出", sample);
    assert.ok(buf[0] === 0x50 && buf[1] === 0x4b, "docx 须为 ZIP");
    const asText = buf.toString("utf8");
    assert.ok(asText.includes("word/numbering.xml"), "ZIP 须含 numbering.xml");
    assert.ok(asText.includes("<w:b/>"), "须含粗体 run");
    assert.ok(asText.includes("<w:numPr>"), "须含列表 numPr");
    assert.ok(asText.includes("Consolas") || asText.includes("const x = 1"), "须含代码样式或代码正文");
    assert.ok(asText.includes("粗体") || asText.includes("标题一"), "须保留中文正文");
  });

  test("文件 Apply 卡片: Diff/还原与写入前确认", () => {
    const md = fs.readFileSync(path.join(rootDir, "src", "components", "ChatStream", "MarkdownRenderer.tsx"), "utf8");
    const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    assert.ok(md.includes("parseFenceHeader"), "必须兼容 Cursor lang:path fence");
    assert.ok(md.includes("confirmBeforeWrite") || md.includes("codex_confirm_before_write"), "必须支持写入前确认");
    assert.ok(md.includes("全部 Apply") || md.includes("handleApplyAll"), "必须有全部 Apply");
    assert.ok(md.includes("onOpenFileDiff"), "必须支持打开 Diff");
    assert.ok(md.includes("onRevertFile"), "必须支持还原");
    assert.ok(app.includes("onOpenFileDiff={handleFileWritten}"), "App 必须接线 Diff");
    assert.ok(app.includes("onRevertFile={handleRevertFile}"), "App 必须接线还原");
  });

  test("Wave D: write_workspace_file 工具真正执行", () => {
    const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
    const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    assert.ok(mainJs.includes("pendingToolCalls"), "main 必须累加 tool_calls");
    assert.ok(mainJs.includes("codex_tool_calls") || mainJs.includes("toolCalls: finishedToolCalls"), "结束时必须回传 toolCalls");
    assert.ok(app.includes("WRITE_WORKSPACE_FILE_TOOL_OPENAI"), "App 必须注册写盘工具");
    assert.ok(app.includes("executeWriteWorkspaceTools"), "App 必须执行写盘工具");
    assert.ok(app.includes("extractTaggedWriteFiles"), "必须支持 @@@write_file 标记兜底");
    assert.ok(app.includes("MAX_WRITE_TOOL_ROUNDS"), "必须限制工具多轮续跑");
    assert.ok(app.includes("tool_call_id") || app.includes("tool_result"), "续跑须回传 tool 结果");
  });

  test("read_workspace_file 只读模式可调用且纯对话不挂载", () => {
    const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    assert.ok(app.includes("READ_WORKSPACE_FILE_TOOL_OPENAI"), "App 必须注册读文件工具");
    assert.ok(app.includes("executeReadWorkspaceTools"), "App 必须执行读文件工具");
    assert.ok(app.includes("readWorkspaceFile"), "读工具必须复用已有读文件通道");
    assert.ok(app.includes("name === 'read_workspace_file'"), "读工具必须进入同一工具循环");
    assert.ok(app.includes("permissionMode !== 'chat-only'"), "纯对话模式不得挂载读工具");
    assert.ok(app.includes("localWorkspaceToolsOpenAI(canUseReadTools, canUseWriteTools)"), "首轮与续跑都要挂读工具");
    assert.ok(app.includes("localWorkspaceToolsAnthropic(canUseReadTools, canUseWriteTools)"), "Anthropic 协议也要挂读工具");
    assert.ok(!app.includes("让我读取核心文件"), "只读提示不得再禁止读文件");
    assert.ok(app.includes("调用工具 `read_workspace_file`"), "只读提示必须要求调用读工具");
    assert.ok(app.includes("禁止调用 `write_workspace_file`"), "只读模式仍须禁止写盘");
    assert.ok(app.includes("hasPendingAgentTools"), "工具调用且正文为空时不得写成鉴权失败");
    assert.ok(!app.includes("请检查 Base URL 与 API Key 是否正确"), "空回复不得再归咎于 API Key");
  });

  test("docx 挂载: @ 中文路径与正文抽取", () => {
    const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
    const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    const preload = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
    assert.ok(mainJs.includes("extractDocxPlainText"), "主进程必须抽取 docx 正文");
    assert.ok(mainJs.includes("extract-docx-text"), "必须提供 docx 抽取 IPC");
    assert.ok(mainJs.includes("readPreviewText"), "预览/差异读取 docx 时必须抽取正文，禁止按 UTF-8 打开");
    assert.ok(app.includes("extractAtFileRefs"), "@ 引用必须能解析中文路径");
    assert.ok(app.includes("已抽取正文"), "挂载 docx 时必须标明已抽取正文");
    assert.ok(preload.includes("extractDocxText"), "preload 必须暴露抽取接口");
  });

  test("pdf 挂载: 附件、@ 与预览抽取正文", () => {
    const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
    const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
    const preload = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
    const composer = fs.readFileSync(path.join(rootDir, "src", "components", "Composer", "Composer.tsx"), "utf8");
    assert.ok(mainJs.includes("extractPdfPlainText"), "主进程必须抽取 PDF 正文");
    assert.ok(mainJs.includes("extract-pdf-text"), "必须提供 PDF 抽取 IPC");
    assert.ok(mainJs.includes('previewKind'), "预览 PDF 时必须抽取正文，禁止按 UTF-8 打开");
    assert.ok(mainJs.includes("扫描件无法读取"), "扫描件必须明确失败，不得把二进制当文本");
    assert.ok(preload.includes("extractPdfText"), "preload 必须暴露 PDF 抽取接口");
    assert.ok(composer.includes("extractPdfText"), "PDF 附件必须抽取正文后再挂载");
    assert.ok(composer.includes(".pdf"), "文件选择器必须接受 .pdf");
    assert.ok(app.includes("docx|pdf"), "@ 挂载 PDF 时必须标明已抽取正文");
    assert.ok(!/ext === '\.pdf'/.test(composer), "PDF 不得再被当成无法读取的办公格式拒绝");
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  runInteractionFeaturesTests();
}
