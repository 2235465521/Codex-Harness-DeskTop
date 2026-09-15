import { useState, useEffect } from 'react';
import { UpdateInfo, UpdateProgress } from '@/types/electron';

export function useUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress>({ percent: 0, downloadedBytes: 0, totalBytes: 0 });
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadedVersion, setDownloadedVersion] = useState('');
  const [isPendingOnQuit, setIsPendingOnQuit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!window.codexDesktop) return;

    if (window.codexDesktop.onUpdateAvailable) {
      window.codexDesktop.onUpdateAvailable((info) => {
        setUpdateInfo(info);
        setIsModalOpen(true);
      });
    }

    if (window.codexDesktop.onUpdateDownloading) {
      window.codexDesktop.onUpdateDownloading(() => {
        setIsDownloading(true);
        setErrorMessage(null);
      });
    }

    if (window.codexDesktop.onUpdateProgress) {
      window.codexDesktop.onUpdateProgress((prog) => {
        setProgress(prog);
      });
    }

    if (window.codexDesktop.onUpdateDownloaded) {
      window.codexDesktop.onUpdateDownloaded((res) => {
        setIsDownloaded(true);
        setDownloadedVersion(res.version);
        setIsDownloading(false);
      });
    }

    if (window.codexDesktop.onUpdatePendingOnQuit) {
      window.codexDesktop.onUpdatePendingOnQuit(() => {
        setIsPendingOnQuit(true);
      });
    }

    if (window.codexDesktop.onUpdateError) {
      window.codexDesktop.onUpdateError((err) => {
        setIsDownloading(false);
        setErrorMessage(err.error || err.message || '更新下载失败');
      });
    }
  }, []);

  const startDownload = () => {
    if (updateInfo && window.codexDesktop && window.codexDesktop.startDownloadUpdate) {
      setIsDownloading(true);
      setErrorMessage(null);
      window.codexDesktop.startDownloadUpdate({
        downloadUrl: updateInfo.downloadUrl,
        version: updateInfo.latestVersion
      });
    }
  };

  const installNow = () => {
    if (window.codexDesktop && window.codexDesktop.applyUpdateNow) {
      window.codexDesktop.applyUpdateNow();
    }
  };

  const installOnQuit = () => {
    setIsPendingOnQuit(true);
    setIsModalOpen(false);
    if (window.codexDesktop && window.codexDesktop.applyUpdateOnQuit) {
      window.codexDesktop.applyUpdateOnQuit();
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const checkForUpdates = () => {
    if (window.codexDesktop && window.codexDesktop.checkForUpdates) {
      window.codexDesktop.checkForUpdates(false);
    }
  };

  return {
    updateInfo,
    isModalOpen,
    setIsModalOpen,
    isDownloading,
    progress,
    isDownloaded,
    downloadedVersion,
    isPendingOnQuit,
    errorMessage,
    startDownload,
    installNow,
    installOnQuit,
    closeModal,
    checkForUpdates
  };
}
