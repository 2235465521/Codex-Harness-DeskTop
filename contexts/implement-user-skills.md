# IMPLEMENT：用户自定义 Skills（MVP）

> 状态：已落地（MVP）  
> 对齐参考：豆包「技能中心」— 本地加载 + 自定义 Skill + `/` 调用  
> 不包含：对话存为 Skill、连接器/MCP、技能市场

---

## 0. 一句话交付物

用户可在 `~/.codex/user-skills/` 管理自己的 Skill（导入 / 新建 / 编辑 / 删除），侧栏与 `/` 菜单可见，发送 `/id` 时与内置技能相同方式注入 system prompt。

---

## 1. 现状锚点（改前必读）

| 点 | 位置 | 现状 |
|----|------|------|
| 列表 | `main.js` → `ipcMain.handle("get-skills")` | 只扫 `__dirname/.agents/skills` |
| 热同步 | `initBuiltinSkills()` | 内置 → `~/.codex/skills`（单向，UI 不读） |
| 桥 | `preload.js` → `getSkills` | 仅 invoke `get-skills` |
| 类型 | `electron.d.ts` → `SkillItem` | 无 `source`；已声明未实现 `onSkillsSynced` |
| 激活 | `App.tsx` → `executeLLMTask` | `^/id` 匹配 `skills` 后注入 system |
| UI | `Sidebar.tsx` 技能 Tab | 分类 + 搜索 + `SkillDetailModal` |
| 校验格式 | `scripts/check-skills.mjs` | 仅扫仓库内置（MVP 不改扫用户目录） |

---

## 2. 目录与文件格式

### 2.1 权威目录

```
~/.codex/user-skills/<skill-id>/SKILL.md
```

- **禁止**写入 `~/.codex/skills`（与内置热同步隔离）
- `skill-id`：`^[a-z0-9][a-z0-9-]{1,63}$`
- 与内置目录名冲突 → 拒绝创建/导入

### 2.2 SKILL.md 模板（保存时生成）

```markdown
---
name: 我的周报助手
description: 根据本周要点生成结构化周报
---

## 步骤
1. ...
## 输出格式
...
```

解析逻辑与现有 `get-skills` frontmatter 正则保持一致。

---

## 3. API 契约

### 3.1 类型扩展（`electron.d.ts`）

```ts
export interface SkillItem {
  id: string;
  name: string;
  description: string;
  prompt: string;
  content?: string;
  displayName?: string;
  chineseSummary?: string;
  category?: string;
  source: 'builtin' | 'user';  // 新增；旧数据缺省按 builtin
  editable?: boolean;           // source==='user'
}

// preload 新增
importUserSkill: () => Promise<{ ok: boolean; skill?: SkillItem; error?: string; code?: string }>;
saveUserSkill: (payload: {
  id: string;
  name: string;
  description: string;
  body: string;
  overwrite?: boolean;
}) => Promise<{ ok: boolean; skill?: SkillItem; error?: string; code?: string }>;
deleteUserSkill: (id: string) => Promise<{ ok: boolean; error?: string; code?: string }>;
openUserSkillsDir?: () => Promise<{ ok: boolean }>;
```

### 3.2 IPC 行为

| Channel | 行为 | 错误码示例 |
|---------|------|------------|
| `get-skills` | 内置全部 + 用户全部；用户项 `source:'user', editable:true`；同 id 若两边都有 → **内置优先**，用户项跳过并 `logAudit` 可选 | — |
| `import-user-skill` | `dialog.showOpenDialog({ properties:['openDirectory'] })` → 目录内必须有 `SKILL.md` → 校验 id/frontmatter → 拷到 `user-skills/<id>/` | `NO_SKILL_MD` / `INVALID_ID` / `ID_CONFLICT_BUILTIN` / `INVALID_FRONTMATTER` |
| `save-user-skill` | 校验 → `mkdir` → 写 `SKILL.md`；`overwrite:false` 且已存在则失败 | `ALREADY_EXISTS` / `ID_CONFLICT_BUILTIN` |
| `delete-user-skill` | 仅删 `user-skills/<id>`；内置 id 直接拒绝 | `NOT_USER_SKILL` / `NOT_FOUND` |
| `open-user-skills-dir` | `fs.mkdirSync` 若不存在 + `shell.openPath` | — |

### 3.3 路径安全（硬门禁）

- 所有写/删目标经 `path.resolve` 后必须 `isPathLogicallyInside(userSkillsRoot, target)`
- 拒绝 `..`、绝对路径逃逸、符号链接逃出根（`realpath` 后再判）

### 3.4 激活链路

不改 `executeLLMTask` 核心算法；保证 `App`/`Sidebar`/`Composer` 持有的 `skills` 来自合并后的 `getSkills()`。

可选：保存/导入/删除成功后 `webContents.send('skills-changed')`，preload 实现已声明的 `onSkillsSynced`（或简化为调用方再 `getSkills()`）。

---

## 4. UI 规格

### 4.1 Sidebar 技能 Tab

1. 顶栏增加：
   - 分段：`全部 | 内置 | 我的`（本地 state）
   - 按钮：`导入`、`新建`（仅影响用户技能）
2. `filteredSkills`：在现有搜索/分类上叠加 `sourceFilter`
3. 卡片：`source==='user'` 显示小角标「我的」
4. 空态（我的且无数据）：文案引导导入或新建

### 4.2 SkillDetailModal / 编辑器

- 内置：保持现有「使用示例 / 填入指令」
- 用户：额外「编辑」「删除」；删除二次确认（可用 `window.confirm` 或小型确认框）

### 4.3 新组件 `UserSkillEditorModal.tsx`

| 字段 | 规则 |
|------|------|
| id | 新建可编辑；编辑锁定 |
| name | 必填 |
| description | 必填，单行建议 ≤200 字 |
| body | 必填 Markdown 正文（不含 frontmatter） |

保存 → `saveUserSkill` → 关闭 → 父级 `refreshSkills()`。

### 4.4 Composer `/` 菜单

- `matchedSkills` 使用合并列表
- 展示名后可跟灰色「我的」（可选，P2）

---

## 5. Wave 拆解（每批 ≤3 文件）

### Wave 1 — 主进程 + 桥 + 类型

**文件**
1. `main.js`
2. `preload.js`
3. `src/types/electron.d.ts`

**任务清单**
- [ ] `getUserSkillsRoot()` → `path.join(os.homedir(), '.codex', 'user-skills')`
- [ ] 抽取 `parseSkillMd(dirName, raw) → SkillItem 基础字段`
- [ ] `listSkillsInDir(dir, source)` 
- [ ] 改造 `get-skills` 合并
- [ ] 实现 import / save / delete / open-dir
- [ ] preload 暴露；类型补齐

**Wave 1 验证**
- 手工或临时脚本：空用户目录时数量 = 内置数
- 写入一个合法 `user-skills/demo-skill/SKILL.md` 后 `get-skills` 含 `source:user`
- 用内置 id（如 `tdd`）save → `ID_CONFLICT_BUILTIN`

### Wave 2 — UI

**文件**
1. `src/components/Sidebar/Sidebar.tsx`
2. `src/components/Modals/UserSkillEditorModal.tsx`（新建）
3. `src/components/Modals/SkillDetailModal.tsx`（编辑/删除入口）

**任务清单**
- [ ] source 分段 + 导入/新建
- [ ] Editor Modal
- [ ] Detail 对用户技能暴露编辑/删除
- [ ] `refreshSkills` 在 CRUD 后调用

**Wave 2 验证**
- UI 导入样例目录 → 「我的」可见
- `/demo-skill` 发送后对话 system/思考区能体现技能激活（或看注入逻辑日志）

### Wave 3 — 测试与说明

**文件**
1. `tests/interaction-features.test.mjs` 或新建 `tests/user-skills.test.mjs`
2. `CHANGELOG.md`
3. `AGENTS.md`（Skills 条目补「支持 user-skills」）

**任务清单**
- [ ] 静态断言：main 含 `user-skills`、`save-user-skill`、`ID_CONFLICT_BUILTIN`
- [ ] 可选：用临时目录模拟 parse/合并（不依赖 Electron dialog）
- [ ] CHANGELOG 一条人话说明
- [ ] `npm test` + `agent-verify`

---

## 6. 测试用例表

| ID | 场景 | 期望 |
|----|------|------|
| T1 | 仅内置 | `get-skills` 全为 `builtin` |
| T2 | 用户合法技能 | 合并列表出现 `user` |
| T3 | id = `tdd` 保存用户技能 | 失败 `ID_CONFLICT_BUILTIN` |
| T4 | 缺 frontmatter 导入 | 失败 `INVALID_FRONTMATTER` |
| T5 | 删除用户技能 | 目录消失且列表无该项 |
| T6 | 删除内置 id | 失败 `NOT_USER_SKILL` |
| T7 | `../` 写路径 | 拒绝 |
| T8 | `/user-id` 发送 | `executeLLMTask` 命中并注入 |

---

## 7. 验收标准（Definition of Done）

1. 「我的」可导入/新建/编辑/删除，内置只读  
2. `/自定义id` 与内置相同注入路径  
3. 用户目录与热同步目录物理隔离  
4. `npm test` 全绿，`agent-verify` PASS  
5. 未引入密钥硬编码；路径沙箱有断言  

---

## 8. 回滚

- 功能开关：若需紧急回滚，可临时让 `get-skills` 跳过 user 目录（一行开关）  
- 用户数据：`~/.codex/user-skills` 不进 Git，删功能不影响内置  

---

## 9. 执行口令

- 回复 **执行** → 从 Wave 1 开始落码  
- 回复 **执行 Wave 2** → 仅 UI（需 Wave 1 已合并）  
- 若要改存储路径或必须做「对话存为 Skill」，先改本 IMPLEMENT 再动刀  
