type Props = {
  text: string;
};

type Block =
  | { type: "text"; value: string }
  | { type: "code"; lang: string; value: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) {
      blocks.push({ type: "text", value: text.slice(last, match.index) });
    }
    blocks.push({
      type: "code",
      lang: match[1] || "code",
      value: match[2].replace(/\n$/, ""),
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    blocks.push({ type: "text", value: text.slice(last) });
  }
  return blocks.length ? blocks : [{ type: "text", value: text }];
}

/** Heuristic: looks like raw code without fences. */
function looksLikeRawCode(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 3) return false;
  const codey = lines.filter((l) =>
    /[{};]|^\s*(def|class|function|const|let|var|import|public|private|return|if|for|while)\b/.test(
      l
    )
  ).length;
  return codey / lines.length > 0.35;
}

export function AnswerContent({ text }: Props) {
  if (!text.trim()) return null;

  let blocks = parseBlocks(text);
  if (blocks.length === 1 && blocks[0].type === "text" && looksLikeRawCode(text)) {
    blocks = [{ type: "code", lang: "code", value: text.trim() }];
  }

  return (
    <div className="answer-content">
      {blocks.map((block, i) =>
        block.type === "code" ? (
          <div key={i} className="code-block">
            <div className="code-block-top">
              <span>{block.lang}</span>
              <button
                type="button"
                className="code-copy"
                onClick={() => void navigator.clipboard.writeText(block.value)}
              >
                Copy
              </button>
            </div>
            <pre>
              <code>{block.value}</code>
            </pre>
          </div>
        ) : (
          <div key={i} className="answer-text-block">
            {block.value.trim()}
          </div>
        )
      )}
    </div>
  );
}
