# IMPLEMENT：MCP 连接器（对齐豆包「标准大数据智能连接器」）

> 状态：实施中（Wave 0 规格已定）  
> 参考：`豆包连接器使用说明.md`  
> 策略：**通用 Streamable HTTP MCP 客户端**；首个预置连接器为标准大数据平台

---

## 0. 一句话交付物

用户可在 Codex Desktop 配置并启用 HTTP MCP 连接器（预填标准大数据 URL），会话中模型可调用其工具；鉴权 Key 仅存本机，主进程权威出网。

---

## 1. 非目标

- 不做 stdio MCP、技能市场、多连接器编排 UI（架构预留多条配置）
- 不把 10 个能力硬编码为 REST
- 不在仓库写入真实 API-Key

---

## 2. 配置模型

路径：`~/.codex/connectors.json`

```json
{
  "connectors": [
    {
      "id": "stsc-data-platform",
      "name": "STSC_data_platform",
      "transport": "http",
      "url": "http://47.106.104.48:8089/api/v1/openapi/doubao/mcp",
      "healthUrl": "http://47.106.104.48:8089/api/v1/health",
      "enabled": false,
      "authHeaderName": "Authorization",
      "apiKeyEncrypted": null,
      "apiKeyPlainHint": ""
    }
  ]
}
```

- Key：优先 `safeStorage.encryptString`；不可用时降级本机文件权限（记 Known Limitation）
- 渲染层永不接收完整 Key，仅 `hasApiKey: boolean`

---

## 3. IPC 契约

| channel | 方向 | 说明 |
|---------|------|------|
| `connectors-list` | R←M | 列表（脱敏） |
| `connectors-save` | R→M | 新增/更新（可带 apiKey 明文一次写入） |
| `connectors-set-enabled` | R→M | 启用/停用 |
| `connectors-test` | R→M | health + MCP initialize/tools/list |
| `connectors-list-tools` | R→M | 已启用连接器的 tools（缓存可短 TTL） |
| `connectors-call-tool` | R→M | `{ connectorId, name, arguments }` |

工具对外名：`mcp__{connectorId}__{toolName}`（LLM tools 合并用）。

---

## 4. 会话挂接

- `App.tsx`：`enabled` 时把 MCP tools 转 OpenAI / Anthropic schema，与 `write_workspace_file` 合并
- 执行：识别 `mcp__` 前缀 → `connectors-call-tool` → 结果进现有多轮工具环
- 轮次上限：与写盘共用或独立 `MAX_MCP_TOOL_ROUNDS`（默认 5）

---

## 5. UI

- 设置弹窗增加「连接器」分区（或独立轻量 Modal）
- 预置 STSC：编辑 URL、粘贴 Bearer Key、启用、测连通
- 测连通成功展示 tool 数量

---

## 6. 验收

| ID | 场景 | 期望 |
|----|------|------|
| C1 | 无 Key 启用 | 测连通失败，友好提示 |
| C2 | 正确 Key + 网络 | health UP 且 tools/list ≥ 1 |
| C3 | 启用后发「智能网联汽车现行国标」 | 模型发起 MCP tool_call 并返回标准号类内容 |
| C4 | 401/429 | 中文错误，不泄 Key |

---

## 7. 波次

1. 本规格  
2. main + preload + types（配置/MCP/IPC）  
3. Settings UI  
4. App 挂接 + 测试  

执行口令：按波次落码；单波 ≤3 文件。
