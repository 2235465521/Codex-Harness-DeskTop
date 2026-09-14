import React, { useEffect, useState } from 'react';
import { X, Save, Sparkles } from 'lucide-react';

export interface UserSkillDraft {
  id: string;
  name: string;
  description: string;
  body: string;
}

interface UserSkillEditorModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: UserSkillDraft | null;
  onClose: () => void;
  onSaved: () => void;
}

const ID_HINT = '小写字母开头，仅含 a-z、0-9、-，长度 2–64';

export const UserSkillEditorModal: React.FC<UserSkillEditorModalProps> = ({
  isOpen,
  mode,
  initial,
  onClose,
  onSaved,
}) => {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setId(initial?.id || '');
    setName(initial?.name || '');
    setDescription(initial?.description || '');
    setBody(initial?.body || '');
    setError(null);
    setSaving(false);
  }, [isOpen, initial, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!window.codexDesktop?.saveUserSkill) {
      setError('当前环境不支持保存用户技能');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await window.codexDesktop.saveUserSkill({
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        body,
        overwrite: mode === 'edit',
      });
      if (!res?.ok) {
        setError(res?.error || '保存失败');
        return;
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存异常');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-lg bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border bg-bg-sidebar flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-text-primary">
                {mode === 'create' ? '新建自定义技能' : '编辑自定义技能'}
              </h3>
              <p className="text-[10px] text-text-muted mt-0.5 truncate">
                保存到 ~/.codex/user-skills/
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors cursor-pointer"
            title="关闭 (ESC)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto text-xs">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary">技能 ID</span>
            <input
              value={id}
              disabled={mode === 'edit' || saving}
              onChange={(e) => setId(e.target.value.trim().toLowerCase())}
              placeholder="my-weekly-report"
              className="w-full px-2.5 py-1.5 bg-bg-sidebar border border-border rounded-lg text-xs text-text-primary font-mono focus:outline-none focus:border-accent disabled:opacity-60"
            />
            <span className="text-[10px] text-text-muted">{ID_HINT}</span>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary">名称</span>
            <input
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的周报助手"
              className="w-full px-2.5 py-1.5 bg-bg-sidebar border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary">描述</span>
            <input
              value={description}
              disabled={saving}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明这个技能做什么"
              className="w-full px-2.5 py-1.5 bg-bg-sidebar border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary">技能正文（Markdown）</span>
            <textarea
              value={body}
              disabled={saving}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder={'## 步骤\n1. …\n\n## 输出格式\n…'}
              className="w-full px-2.5 py-2 bg-bg-sidebar border border-border rounded-lg text-xs text-text-primary font-mono leading-relaxed focus:outline-none focus:border-accent resize-y min-h-[180px]"
            />
          </label>

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border bg-bg-sidebar flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:brightness-110 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Save size={13} />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};
