import React from 'react';
import { X, Rocket, Sparkles, Download, CheckCircle2 } from 'lucide-react';
import { UpdateInfo, UpdateProgress } from '@/types/electron';

interface UpdatePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
  isDownloading: boolean;
  progress: UpdateProgress;
  isDownloaded: boolean;
  downloadedVersion: string;
  errorMessage?: string | null;
  onStartDownload: () => void;
  onInstallNow?: () => void;
  onInstallOnQuit?: () => void;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
  isDownloading,
  progress,
  isDownloaded,
  downloadedVersion,
  errorMessage,
  onStartDownload,
  onInstallNow,
  onInstallOnQuit,
}) => {
  if (!isOpen || !updateInfo) return null;

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 MB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-accent to-accent-secondary text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shadow-inner">
              <Rocket size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold">发现全新版本 v{updateInfo.latestVersion}</h3>
              <p className="text-xs text-orange-100">当前版本: v{updateInfo.currentVersion || '1.1.8'} · 支持在线无感就地升级</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/20 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" />
              <span>更新内容与变更说明：</span>
            </div>
            <div className="p-3 bg-bg-sidebar border border-border rounded-xl text-xs text-text-secondary leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
              {updateInfo.body || '常规性能提升、界面自适应与体验优化。'}
            </div>
          </div>

          {/* 错误提示 */}
          {errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
              下载遇到异常: {errorMessage}，请检查网络后重试。
            </div>
          )}

          {/* 下载进度条 */}
          {isDownloading && (
            <div className="space-y-1.5 p-3.5 bg-bg-sidebar rounded-xl border border-border">
              <div className="flex items-center justify-between text-xs text-text-secondary font-mono">
                <span>正在高速下载安装包...</span>
                <span>
                  {progress.percent}% {progress.totalBytes > 0 && `(${formatSize(progress.downloadedBytes)} / ${formatSize(progress.totalBytes)})`}
                </span>
              </div>
              <div className="h-2.5 bg-bg-card rounded-full overflow-hidden border border-border">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-secondary transition-all duration-150"
                  style={{ width: `${Math.max(3, progress.percent)}%` }}
                />
              </div>
            </div>
          )}

          {/* 下载就绪说明 */}
          {isDownloaded && (
            <div className="p-3.5 bg-green-500/10 border border-green-500/30 rounded-xl text-xs text-green-400 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} />
                <span>新版本 v{downloadedVersion} 已下载就绪！</span>
              </div>
              <p className="text-[11px] text-green-300/80 pl-6 leading-relaxed">
                无需手动卸载软件，升级将自动静默覆写更新，所有历史会话、API 密钥与自定义技能 100% 完整保留。
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-sidebar flex items-center justify-end gap-2.5">
          {isDownloaded ? (
            <>
              <button
                onClick={onInstallOnQuit || onClose}
                className="px-4 py-2 border border-border hover:bg-bg-hover text-text-secondary rounded-lg text-xs font-medium transition-colors"
              >
                稍后退出时自动升级
              </button>
              <button
                onClick={onInstallNow}
                className="px-5 py-2 bg-gradient-to-r from-accent to-accent-secondary hover:brightness-110 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all"
              >
                <Rocket size={14} />
                <span>⚡ 立即重启完成升级</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-border hover:bg-bg-hover text-text-secondary rounded-lg text-xs font-medium transition-colors"
              >
                稍后再说
              </button>
              <button
                onClick={onStartDownload}
                disabled={isDownloading}
                className="px-5 py-2 bg-gradient-to-r from-accent to-accent-secondary hover:brightness-110 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all"
              >
                <Download size={14} />
                <span>{isDownloading ? '正在后台下载...' : '⚡ 立即下载更新'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
