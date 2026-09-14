import React, { useEffect, useState } from 'react';
import {
  X,
  Plug,
  Key,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { ConnectorPublic } from '@/types/electron';

interface ConnectorsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectorsModal: React.FC<ConnectorsModalProps> = ({ isOpen, onClose }) => {
  const [connectors, setConnectors] = useState<ConnectorPublic[]>([]);
  const [activeId, setActiveId] = useState('stsc-data-platform');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [url, setUrl] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toolPreview, setToolPreview] = useState<{ name: string; description: string }[]>([]);

  const load = async () => {
    if (!window.codexDesktop?.listConnectors) return;
    const res = await window.codexDesktop.listConnectors();
    if (res?.ok && res.connectors?.length) {
      setConnectors(res.connectors);
      const cur = res.connectors.find((c) => c.id === activeId) || res.connectors[0];
      setActiveId(cur.id);
      setName(cur.name);
      setUrl(cur.url);
      setHealthUrl(cur.healthUrl || '');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput('');
      setTestMsg(null);
      setToolPreview([]);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const current = connectors.find((c) => c.id === activeId) || connectors[0];

  const handleSave = async () => {
    if (!window.codexDesktop?.saveConnector || !current) return;
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await window.codexDesktop.saveConnector({
        id: current.id,
        name: name.trim() || current.name,
        url: url.trim() || current.url,
        healthUrl: healthUrl.trim(),
        enabled: current.enabled,
        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
      });
      if (!res?.ok) {
        setTestMsg({ ok: false, text: res?.error || '保存失败' });
        return;
      }
      setApiKeyInput('');
      await load();
      setTestMsg({ ok: true, text: '已保存连接器配置' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!window.codexDesktop?.setConnectorEnabled || !current) return;
    if (enabled && !current.hasApiKey && !apiKeyInput.trim()) {
      setTestMsg({ ok: false, text: '请先粘贴并保存 API Key，再启用连接器' });
      return;
    }
    setBusy(true);
    try {
      // 启用前若输入框有新 Key，先落盘
      if (enabled && apiKeyInput.trim() && window.codexDesktop.saveConnector) {
        const saved = await window.codexDesktop.saveConnector({
          id: current.id,
          name: name.trim() || current.name,
          url: url.trim() || current.url,
          healthUrl: healthUrl.trim(),
          apiKey: apiKeyInput.trim(),
        });
        if (!saved?.ok) {
          setTestMsg({ ok: false, text: saved?.error || '保存 Key 失败' });
          return;
        }
        setApiKeyInput('');
      }
      const res = await window.codexDesktop.setConnectorEnabled({ id: current.id, enabled });
      if (!res?.ok) {
        setTestMsg({ ok: false, text: res?.error || '切换失败' });
        return;
      }
      await load();
      setTestMsg({
        ok: true,
        text: enabled ? '已启用：会话将注入该连接器工具' : '已停用连接器',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (!window.codexDesktop?.testConnector || !current) return;
    // 若有新 Key 先保存再测
    if (apiKeyInput.trim() && window.codexDesktop.saveConnector) {
      await window.codexDesktop.saveConnector({
        id: current.id,
        name: name.trim() || current.name,
        url: url.trim() || current.url,
        healthUrl: healthUrl.trim(),
        apiKey: apiKeyInput.trim(),
      });
      setApiKeyInput('');
      await load();
    }
    setBusy(true);
    setTestMsg(null);
    setToolPreview([]);
    try {
      const res = await window.codexDesktop.testConnector({ id: current.id });
      if (!res?.ok) {
        setTestMsg({ ok: false, text: res?.error || '连通失败' });
        return;
      }
      setToolPreview(res.tools || []);
      setTestMsg({
        ok: true,
        text: `连通成功：发现 ${res.toolCount ?? 0} 个工具；health=${res.health?.status ?? 'n/a'}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-sidebar">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Plug size={16} className="text-accent" />
            MCP 连接器
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <p className="text-text-muted leading-relaxed">
            对齐豆包「标准大数据智能连接器」：通过 Streamable HTTP MCP 接入远程工具。
            API Key 仅保存在本机（主进程加密），不会写入仓库。
          </p>

          {current && (
            <>
              <label className="block space-y-1">
                <span className="text-text-secondary font-medium">名称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-sidebar text-text-primary focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-secondary font-medium">MCP URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-sidebar text-text-primary font-mono text-[11px] focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-secondary font-medium">Health URL（可选）</span>
                <input
                  value={healthUrl}
                  onChange={(e) => setHealthUrl(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-sidebar text-text-primary font-mono text-[11px] focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-secondary font-medium flex items-center gap-1">
                  <Key size={12} /> API Key（Bearer）
                  {current.hasApiKey && (
                    <span className="text-emerald-400 font-normal">· 已保存</span>
                  )}
                </span>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={current.hasApiKey ? '留空则保持已保存的 Key' : '粘贴生产 API-Key（可含或不含 Bearer 前缀）'}
                    className="w-full px-2.5 py-1.5 pr-9 rounded-lg border border-border bg-bg-sidebar text-text-primary font-mono text-[11px] focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSave}
                  className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 cursor-pointer disabled:opacity-50"
                >
                  保存配置
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleTest}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-sidebar border border-border hover:bg-bg-hover cursor-pointer disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
                  测连通
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleToggle(!current.enabled)}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer disabled:opacity-50 ${
                    current.enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-bg-sidebar border-border text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {current.enabled ? '已启用（点击停用）' : '未启用（点击启用）'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={load}
                  className="p-1.5 rounded-lg border border-border hover:bg-bg-hover cursor-pointer disabled:opacity-50"
                  title="刷新"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </>
          )}

          {testMsg && (
            <div
              className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${
                testMsg.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {testMsg.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
              <span className="leading-relaxed">{testMsg.text}</span>
            </div>
          )}

          {toolPreview.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-bg-sidebar p-2 space-y-1">
              <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-1">
                工具预览（最多 30）
              </div>
              {toolPreview.map((t) => (
                <div key={t.name} className="px-1.5 py-1 rounded hover:bg-bg-hover">
                  <div className="font-mono text-accent text-[11px]">{t.name}</div>
                  <div className="text-text-muted line-clamp-1">{t.description || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
