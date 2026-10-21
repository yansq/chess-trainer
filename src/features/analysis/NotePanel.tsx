import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../../shared/api";

type Props = {
  gameId: string;
  moveId: string | null;
  heading: string;
  content: string;
  temporary?: boolean;
  onSaved: (content: string) => void;
  onError: (message: string) => void;
};
export default function NotePanel({
  gameId,
  moveId,
  heading,
  content,
  temporary = false,
  onSaved,
  onError,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  async function save() {
    try {
      if (!temporary) await api.saveAnnotation(gameId, moveId, draft);
      onSaved(draft);
      setEditing(false);
    } catch (e) {
      onError(String(e));
    }
  }
  function startEditing() {
    setDraft(content);
    setEditing(true);
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-panel-edge bg-panel">
      <div className="section-title shrink-0 border-b border-panel-edge px-3 py-1.5 text-body-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
        {heading}
        <span>Markdown</span>
      </div>
      {editing ? (
        <>
          <textarea
            className="m-1.5 block min-h-9 w-note-field flex-1 resize-none px-2 py-1 text-body-sm leading-5"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="记录判断、候选招法、犯错原因…"
          />
        </>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain cursor-text break-words [&_pre]:overflow-auto [&_img]:max-w-full p-2 text-body-sm leading-normal [&_p]:mb-2 [&_p]:mt-0"
          onClick={startEditing}
        >
          {content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <span className="text-muted">点击添加笔记…</span>
          )}
        </div>
      )}
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-panel-edge px-3 py-1.5 [&_button]:px-2 [&_button]:py-1.5 [&_button]:text-xs">
        <button
          className="border-control-edge bg-secondary text-secondary-ink"
          onClick={editing ? () => void save() : startEditing}
        >
          {editing ? (temporary ? "暂存笔记" : "保存笔记") : "编辑笔记"}
        </button>
      </div>
    </div>
  );
}
