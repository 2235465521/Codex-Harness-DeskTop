import React from 'react';
import { DocxRichDocument, RichDocumentBlock } from '../../types/electron';
import { renderLatex } from '../../utils/math';
import { Plus, Maximize2, Image as ImageIcon, Sigma, Table as TableIcon } from 'lucide-react';

export interface DocxReaderProps {
  document: DocxRichDocument;
  onAttachImage?: (img: { id: string; name: string; dataUrl: string }) => void;
  onOpenLightbox?: (dataUrl: string, name?: string) => void;
}

export const DocxReader: React.FC<DocxReaderProps> = ({
  document: doc,
  onAttachImage,
  onOpenLightbox,
}) => {
  if (!doc || !doc.blocks || doc.blocks.length === 0) {
    return (
      <div className="p-8 text-center text-text-muted text-xs">
        <p>文档正文为空或未能解析出结构化内容。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 text-text-primary select-text">
      {/* 文档统计小栏 */}
      <div className="flex items-center justify-between pb-3 border-b border-border/60 text-[11px] text-text-muted">
        <span className="font-medium truncate pr-2 max-w-[200px]" title={doc.title || 'Word 文档'}>
          {doc.title || 'Word 富文本文档'}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {doc.mathCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-mono text-[10px]" title="包含的数学公式数">
              <Sigma size={10} />
              <span>{doc.mathCount} 公式</span>
            </span>
          )}
          {doc.imagesCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono text-[10px]" title="包含的图片图表数">
              <ImageIcon size={10} />
              <span>{doc.imagesCount} 图片</span>
            </span>
          )}
        </div>
      </div>

      {/* 块流渲染 */}
      <div className="space-y-3.5">
        {doc.blocks.map((block: RichDocumentBlock, idx: number) => {
          switch (block.type) {
            case 'heading': {
              const level = block.level || 1;
              const content = (block.runs || []).map((run, rIdx) => {
                if (run.type === 'math') {
                  return (
                    <span
                      key={rIdx}
                      className="inline-math px-1 py-0.5 mx-0.5 rounded bg-accent/10"
                      dangerouslySetInnerHTML={{ __html: renderLatex(run.text, false) }}
                    />
                  );
                }
                return run.text;
              });

              if (level === 1) {
                return (
                  <h1 key={idx} className="text-base font-bold text-text-primary mt-4 mb-2 pb-1 border-b border-border/40 tracking-tight">
                    {content}
                  </h1>
                );
              }
              if (level === 2) {
                return (
                  <h2 key={idx} className="text-sm font-bold text-text-primary mt-3 mb-1.5">
                    {content}
                  </h2>
                );
              }
              return (
                <h3 key={idx} className="text-xs font-semibold text-text-primary mt-2.5 mb-1">
                  {content}
                </h3>
              );
            }

            case 'paragraph': {
              return (
                <p key={idx} className="text-[12.5px] leading-relaxed text-text-secondary break-words">
                  {(block.runs || []).map((run, rIdx) => {
                    if (run.type === 'math') {
                      return (
                        <span
                          key={rIdx}
                          className="inline-math px-1 py-0.5 mx-0.5 rounded bg-accent/10 inline-block align-middle"
                          dangerouslySetInnerHTML={{ __html: renderLatex(run.text, false) }}
                        />
                      );
                    }
                    if (run.type === 'bold') {
                      return <strong key={rIdx} className="font-semibold text-text-primary">{run.text}</strong>;
                    }
                    if (run.type === 'italic') {
                      return <em key={rIdx} className="italic text-text-primary">{run.text}</em>;
                    }
                    return <span key={rIdx}>{run.text}</span>;
                  })}
                </p>
              );
            }

            case 'math-block': {
              return (
                <div
                  key={idx}
                  className="my-3 py-2.5 px-4 bg-bg-base/70 border border-border/80 rounded-xl flex justify-center items-center overflow-x-auto shadow-2xs group relative"
                >
                  <div
                    className="select-text"
                    dangerouslySetInnerHTML={{ __html: renderLatex(block.latex || '', true) }}
                  />
                </div>
              );
            }

            case 'table': {
              const rows = block.tableData || [];
              if (rows.length === 0) return null;
              const [headerRow, ...bodyRows] = rows;
              return (
                <div key={idx} className="my-3 overflow-hidden rounded-xl border border-border/80 bg-bg-card/60 shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[11.5px] leading-relaxed text-text-primary min-w-full">
                      <thead>
                        <tr className="bg-bg-sidebar/90 border-b border-border font-semibold select-none">
                          {headerRow.map((cell, cIdx) => (
                            <th key={cIdx} className="px-3 py-2 text-left font-semibold">
                              {cell}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {bodyRows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-bg-hover/40 transition-colors">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-3 py-1.5 text-text-secondary select-text">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            case 'image': {
              const img = block.image;
              if (!img || !img.dataUrl) return null;
              return (
                <div key={idx} className="my-3.5 group relative rounded-xl overflow-hidden border border-border/80 bg-bg-base/80 p-2 shadow-xs transition-all hover:border-accent/50">
                  <div className="flex justify-center items-center overflow-hidden rounded-lg bg-black/10 min-h-[120px] max-h-[380px]">
                    <img
                      src={img.dataUrl}
                      alt={img.alt || img.name}
                      className="max-h-[360px] max-w-full object-contain select-none transition-transform duration-200 group-hover:scale-[1.01]"
                      loading="lazy"
                    />
                  </div>

                  {/* 悬浮操作胶囊栏 */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-bg-sidebar/95 backdrop-blur-md px-2 py-1 rounded-lg border border-border shadow-md">
                    {onOpenLightbox && (
                      <button
                        type="button"
                        onClick={() => onOpenLightbox(img.dataUrl, img.name)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                        title="全屏高清查看"
                      >
                        <Maximize2 size={11} />
                        <span>看大图</span>
                      </button>
                    )}
                    {onAttachImage && (
                      <button
                        type="button"
                        onClick={() => onAttachImage({ id: img.id, name: img.name, dataUrl: img.dataUrl })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-white text-[10.5px] font-medium hover:bg-accent/90 transition-colors cursor-pointer shadow-2xs"
                        title="将此图挂载至输入框，由视觉大模型解读"
                      >
                        <Plus size={11} />
                        <span>引用至会话</span>
                      </button>
                    )}
                  </div>

                  {/* 图片底部文件名 */}
                  <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-text-muted">
                    <span className="truncate max-w-[240px] font-mono">{img.name}</span>
                  </div>
                </div>
              );
            }

            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};
