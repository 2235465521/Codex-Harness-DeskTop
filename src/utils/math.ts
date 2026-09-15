import katex from 'katex';

export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 安全渲染 LaTeX 公式为 HTML 字符串
 * @param latex LaTeX 数学公式源码
 * @param displayMode 是否为块级独立居中公式
 */
export function renderLatex(latex: string, displayMode = false): string {
  if (!latex || typeof latex !== 'string') return '';
  const trimmed = latex.trim();
  if (!trimmed) return '';
  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
      trust: false,
    });
  } catch {
    return `<span class="katex-error text-rose-400 font-mono text-xs">${escapeHtml(trimmed)}</span>`;
  }
}
