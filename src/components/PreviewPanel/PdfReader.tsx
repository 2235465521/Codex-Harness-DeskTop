import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { ZoomIn, ZoomOut, RotateCw, Loader2, AlertCircle, Maximize } from 'lucide-react';

// 配置 PDF.js worker
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface PdfReaderProps {
  base64Data: string;
}

export const PdfReader: React.FC<PdfReaderProps> = ({ base64Data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderedPagesRef = useRef<Map<number, boolean>>(new Map());

  // 初始化加载 PDF 文档
  useEffect(() => {
    let isCancelled = false;
    renderedPagesRef.current.clear();

    if (!base64Data) {
      setLoading(false);
      setError('缺少 PDF 字节流数据');
      return;
    }

    setLoading(true);
    setError(null);

    const raw = base64Data.replace(/^data:[^,]*,/, '');
    const binary = atob(raw);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const loadTask = pdfjsLib.getDocument({
      data: bytes,
      cMapPacked: true,
      standardFontDataUrl: undefined,
    });

    loadTask.promise
      .then((doc) => {
        if (isCancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('[PdfReader] 加载 PDF 失败:', err);
          setError(err?.message || '加载 PDF 文件失败');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [base64Data]);

  // 逐页渲染到 Canvas
  const renderPage = useCallback(
    async (pageNumber: number, canvas: HTMLCanvasElement) => {
      const doc = pdfDocRef.current;
      if (!doc || !canvas) return;

      try {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) return;

        // 根据设备像素比清晰化渲染
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.scale(dpr, dpr);

        const renderContext = {
          canvasContext: context,
          viewport,
        };

        await page.render(renderContext).promise;
      } catch (e: any) {
        // 渲染被打断属正常
        if (e?.name !== 'RenderingCancelledException') {
          console.error(`渲染第 ${pageNumber} 页异常:`, e);
        }
      }
    },
    [scale]
  );

  const handleZoomIn = () => setScale((s) => Math.min(2.5, +(s + 0.2).toFixed(1)));
  const handleZoomOut = () => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)));
  const handleResetZoom = () => setScale(1.0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-text-muted space-y-3">
        <Loader2 size={24} className="animate-spin text-accent" />
        <span className="text-xs">正在渲染 PDF 高清矢量画布...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-rose-400 space-y-2 text-center">
        <AlertCircle size={24} />
        <p className="text-xs">{error}</p>
        <p className="text-[10px] text-text-muted">请检查是否为加密或损坏的 PDF 文档</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-base select-none">
      {/* 顶部缩放与页码工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-sidebar/80 border-b border-border text-[11px] shrink-0">
        <div className="flex items-center gap-1.5 text-text-secondary font-mono">
          <span>共 {numPages} 页</span>
          <span className="text-border">|</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors cursor-pointer"
            title="缩小"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer font-mono"
            title="恢复 100%"
          >
            100%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= 2.5}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors cursor-pointer"
            title="放大"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>

      {/* 纵向连续平滑滚动列表 */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col items-center">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <PdfPageCanvas key={pageNum} pageNumber={pageNum} scale={scale} onRender={renderPage} />
        ))}
      </div>
    </div>
  );
};

interface PdfPageCanvasProps {
  pageNumber: number;
  scale: number;
  onRender: (pageNumber: number, canvas: HTMLCanvasElement) => Promise<void>;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = React.memo(({ pageNumber, scale, onRender }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let active = true;
    if (canvasRef.current) {
      onRender(pageNumber, canvasRef.current).then(() => {
        if (active) setRendered(true);
      });
    }
    return () => {
      active = false;
    };
  }, [pageNumber, scale, onRender]);

  return (
    <div className="relative rounded-lg overflow-hidden shadow-md bg-white border border-border/80 flex flex-col items-center">
      <canvas ref={canvasRef} className="block select-none" />
      <div className="absolute bottom-1 right-2 px-1.5 py-0.5 rounded bg-black/50 text-white/80 font-mono text-[9px] select-none pointer-events-none">
        P.{pageNumber}
      </div>
    </div>
  );
});
