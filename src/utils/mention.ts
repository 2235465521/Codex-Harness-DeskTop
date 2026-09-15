export const AT_FILE_EXTS =
  'docx|xlsx|xls|pdf|doc|pptx|txt|md|json|js|jsx|ts|tsx|mjs|cjs|py|css|html|htm|yml|yaml|xml|csv|sh|ps1|java|go|rs|toml|ini|vue|c|cpp|h|hpp|cs|kt|swift|rb|php|sql|bat|env|svg|png|jpg|jpeg|gif|webp|log|diff|patch|lock';

export interface AtMentionToken {
  start: number;
  end: number;
  raw: string;
}

export interface MentionDeletionResult {
  newText: string;
  newCursorPos: number;
  deletedRange: [number, number];
  deletedToken: string;
}

/**
 * 提取文本中所有合法的 @ 引用标记。
 * 支持三种模式：
 * 1. 引号包裹: @"..." 或 @'...' (支持包含空格与特殊字符的路径)
 * 2. 常见已知文件扩展名: @path/to/file.ext (支持中文与路径层级)
 * 3. 通用无空格标记: @path/to/file 或 @identifier
 * 
 * 严格防护：@ 必须位于行首、空格后或标点符号后，杜绝匹配类似 user@example.com 的邮箱地址。
 */
export function getAtMentionTokens(text: string): AtMentionToken[] {
  if (!text || !text.includes('@')) return [];

  const tokens: AtMentionToken[] = [];
  const regex = new RegExp(
    '(?:^|[\\s,，。！？!?；;（）()\\[\\]{}"\'`])(@"[^"\\n]+"|@\'[^\'\\n]+\'|@[^\\s@"\'`][^\\n@]*?\\.(?:' +
      AT_FILE_EXTS +
      ')(?=[\\s,，。；;）)\\]}]|$)|@[^\\s,，。！？!?；;（）()\\[\\]{}"\'`]+)',
    'g'
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0];
    const mention = match[1];
    if (!mention) continue;

    const atIndex = match.index + (fullMatch.length - mention.length);
    const endIndex = atIndex + mention.length;
    tokens.push({
      start: atIndex,
      end: endIndex,
      raw: mention,
    });
  }
  return tokens;
}

/**
 * 判断当前光标处是否在删除 @ 整体引用。
 * 若命中，则返回原子化删除后的文本与目标光标位置；若未命中则返回 null。
 *
 * @param text 当前输入框完整文本
 * @param cursorPos 当前光标位置 (selectionStart === selectionEnd)
 * @param key 按下的键 ('Backspace' | 'Delete')
 */
export function handleAtMentionDeletion(
  text: string,
  cursorPos: number,
  key: 'Backspace' | 'Delete'
): MentionDeletionResult | null {
  if (!text || !text.includes('@')) return null;
  const tokens = getAtMentionTokens(text);
  if (tokens.length === 0) return null;

  for (const token of tokens) {
    let target = false;
    if (key === 'Backspace') {
      // 1. 光标位于 @ 标记内部或正好在末尾 (例如: @file.docx|)
      if (cursorPos > token.start && cursorPos <= token.end) {
        target = true;
      }
      // 2. 光标紧随在 @ 标记的尾部空格之后 (例如: @file.docx |)
      else if (cursorPos === token.end + 1 && text.charAt(token.end) === ' ') {
        target = true;
      }
    } else if (key === 'Delete') {
      // 光标正好在 @ 前方或内部 (例如: |@file.docx 或 @fi|le.docx)
      if (cursorPos >= token.start && cursorPos < token.end) {
        target = true;
      }
    }

    if (target) {
      let delStart = token.start;
      let delEnd = token.end;

      // 智能空格清理：
      // 若 @ 标记后面紧跟单个空格，一并将其原子化删除，避免残留孤立空字符
      if (text.charAt(delEnd) === ' ') {
        delEnd += 1;
      } else if (
        delStart > 0 &&
        text.charAt(delStart - 1) === ' ' &&
        (delEnd >= text.length || /^[\s,，。！？!?；;、）)\]}]/.test(text.charAt(delEnd)))
      ) {
        // 若尾部无空格但前方有空格，且后面是标点符号或行末，顺带清理前方空格
        delStart -= 1;
      }

      const newText = text.slice(0, delStart) + text.slice(delEnd);
      return {
        newText,
        newCursorPos: delStart,
        deletedRange: [delStart, delEnd],
        deletedToken: token.raw,
      };
    }
  }

  return null;
}
