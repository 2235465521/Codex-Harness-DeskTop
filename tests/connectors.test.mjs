/**
 * Seam 5.6: MCP 连接器（HTTP）静态契约断言
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

runTest("main.js: 连接器配置与 MCP IPC", () => {
  const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
  assert.ok(mainJs.includes("stsc-data-platform"));
  assert.ok(mainJs.includes("connectors.json"));
  assert.ok(mainJs.includes('ipcMain.handle("connectors-list"'));
  assert.ok(mainJs.includes('ipcMain.handle("connectors-save"'));
  assert.ok(mainJs.includes('ipcMain.handle("connectors-test"'));
  assert.ok(mainJs.includes('ipcMain.handle("connectors-list-tools"'));
  assert.ok(mainJs.includes('ipcMain.handle("connectors-call-tool"'));
  assert.ok(mainJs.includes("ensureMcpSession"));
  assert.ok(mainJs.includes("mcpNotify"));
  assert.ok(mainJs.includes("tools/list"));
  assert.ok(mainJs.includes("tools/call"));
  assert.ok(mainJs.includes("请先保存 API Key 再启用"));
  assert.ok(mainJs.includes("请先保存 API Key 再测试连接器"));
  assert.ok(mainJs.includes("safeStorage"));
});

runTest("preload + 类型: 暴露连接器 API", () => {
  const preload = fs.readFileSync(path.join(rootDir, "preload.js"), "utf8");
  const types = fs.readFileSync(path.join(rootDir, "src", "types", "electron.d.ts"), "utf8");
  assert.ok(preload.includes("listConnectors:"));
  assert.ok(preload.includes("testConnector:"));
  assert.ok(preload.includes("callConnectorTool:"));
  assert.ok(types.includes("ConnectorPublic"));
  assert.ok(types.includes("listConnectors?:"));
  assert.ok(types.includes("callConnectorTool?:"));
});

runTest("UI/App: 连接器弹窗与工具挂接", () => {
  const modal = fs.readFileSync(
    path.join(rootDir, "src", "components", "Modals", "ConnectorsModal.tsx"),
    "utf8"
  );
  const app = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
  assert.ok(modal.includes("MCP 连接器"));
  assert.ok(modal.includes("testConnector"));
  assert.ok(app.includes("ConnectorsModal"));
  assert.ok(app.includes("listConnectorTools"));
  assert.ok(app.includes("executeAgentTools"));
  assert.ok(app.includes("mcp__"));
  assert.ok(app.includes("connectorToolsToOpenAI"));
});

runTest("规格文档存在", () => {
  const spec = fs.readFileSync(
    path.join(rootDir, "contexts", "implement-doubao-connector.md"),
    "utf8"
  );
  assert.ok(spec.includes("Streamable HTTP MCP"));
  assert.ok(spec.includes("connectors-call-tool"));
});

if (!process.exitCode) {
  process.stdout.write(`Seam 5.6 connectors: ${passed} passed\n`);
}
