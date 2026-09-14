/**
 * Seam 5.5: 用户自定义 Skills（~/.codex/user-skills）静态契约断言
 */
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let passed = 0;
function runTest(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  [PASS] ${name}\n`);
  } catch (err) {
    process.stderr.write(`  [FAIL] ${name}\n${err.stack || err}\n`);
    process.exitCode = 1;
  }
}

runTest("main.js: 用户技能目录与 get-skills 合并内置/用户", () => {
  const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
  assert.ok(mainJs.includes('path.join(os.homedir(), ".codex", "user-skills")'));
  assert.ok(mainJs.includes('listSkillsInDir(getUserSkillsRoot(), "user")'));
  assert.ok(mainJs.includes('source === "user"'));
  assert.ok(mainJs.includes('ipcMain.handle("import-user-skill"'));
  assert.ok(mainJs.includes('ipcMain.handle("save-user-skill"'));
  assert.ok(mainJs.includes('ipcMain.handle("delete-user-skill"'));
  assert.ok(mainJs.includes('ipcMain.handle("open-user-skills-dir"'));
  assert.ok(mainJs.includes("ID_CONFLICT_BUILTIN"));
  assert.ok(mainJs.includes("NO_SKILL_MD"));
  assert.ok(mainJs.includes("INVALID_ID"));
});

runTest("main.js: 用户技能写删 realpath 沙箱与非法 id 过滤", () => {
  const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
  assert.ok(mainJs.includes("function assertUserSkillTargetSafe"));
  assert.ok(mainJs.includes("物理链接逃逸"));
  assert.ok(mainJs.includes("fs.realpathSync(targetPath)"));
  assert.ok(mainJs.includes("跳过非法用户技能目录名"));
  assert.ok(mainJs.includes("跳过逃逸用户技能目录"));
  assert.ok(mainJs.includes("SKILL_ID_RE.test(entry.name)"));
});

runTest("preload.js + 类型: 暴露用户技能 CRUD API", () => {
  const preload = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
  const types = fs.readFileSync(path.join(rootDir, "src", "types", "electron.d.ts"), "utf8");
  assert.ok(preload.includes("importUserSkill:"));
  assert.ok(preload.includes("saveUserSkill:"));
  assert.ok(preload.includes("deleteUserSkill:"));
  assert.ok(preload.includes("openUserSkillsDir:"));
  assert.ok(types.includes("source?: 'builtin' | 'user'"));
  assert.ok(types.includes("importUserSkill?:"));
  assert.ok(types.includes("saveUserSkill?:"));
});

runTest("Sidebar/编辑器: 来源筛选与导入新建增量入口", () => {
  const sidebar = fs.readFileSync(path.join(rootDir, "src", "components", "Sidebar", "Sidebar.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(rootDir, "src", "components", "Modals", "UserSkillEditorModal.tsx"), "utf8");
  const detail = fs.readFileSync(path.join(rootDir, "src", "components", "Modals", "SkillDetailModal.tsx"), "utf8");
  assert.ok(sidebar.includes("skillSourceFilter"));
  assert.ok(sidebar.includes("handleImportUserSkill"));
  assert.ok(sidebar.includes("UserSkillEditorModal"));
  assert.ok(sidebar.includes("'我的'"));
  assert.ok(sidebar.includes("source !== 'user'"));
  assert.ok(editor.includes("saveUserSkill"));
  assert.ok(detail.includes("onEditUserSkill"));
  assert.ok(detail.includes("onDeleteUserSkill"));
});

runTest("App.tsx: 发送前刷新技能列表以激活用户 /id", () => {
  const appTsx = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
  assert.ok(appTsx.includes("skillsSnapshot"));
  assert.ok(appTsx.includes("slashMenuOpen"));
});

runTest("Composer: 斜杠菜单用户技能显示「我的」角标", () => {
  const composer = fs.readFileSync(
    path.join(rootDir, "src", "components", "Composer", "Composer.tsx"),
    "utf8"
  );
  assert.ok(composer.includes("sk.source"), "须读取 skill.source");
  assert.ok(composer.includes("我的"), "须渲染「我的」角标");
  assert.ok(composer.includes("isUser"), "须区分用户技能");
});

if (!process.exitCode) {
  process.stdout.write(`Seam 5.5 user-skills: ${passed} passed\n`);
}
