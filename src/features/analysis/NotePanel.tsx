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
  onCreatePuzzle: () => void;
};
export default function NotePanel({
  gameId,
  moveId,
  heading,
  content,
  temporary = false,
  onSaved,
  onError,
  onCreatePuzzle,
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
    <div className="panel note-panel rounded-xl border border-panel-edge bg-panel [&_textarea]:m-[15px] [&_textarea]:w-[calc(100%_-_30px)]">
      <div className="section-title border-b border-panel-edge px-[18px] py-4 text-[14px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
        {heading}
        <span>Markdown</span>
      </div>
      {editing ? (
        <>
          <textarea
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="记录判断、候选招法、犯错原因…"
          />
          <div className="row-end flex justify-end gap-[9px] border-t border-panel-edge px-4 py-3">
            <button onClick={() => void save()}>
              {temporary ? "暂存笔记" : "保存笔记"}
            </button>
          </div>
        </>
      ) : (
        <div
          className="note-preview min-h-[108px] cursor-text p-[18px] text-[14px] leading-normal [&_p]:mb-2 [&_p]:mt-0"
          onClick={startEditing}
        >
          {content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <span className="muted text-muted">点击添加笔记…</span>
          )}
        </div>
      )}
      <div className="note-actions flex justify-end gap-[9px] border-t border-panel-edge px-4 py-3 [&_button]:px-[11px] [&_button]:py-2 [&_button]:text-[12px]">
        <button
          className="secondary border-control-edge bg-secondary text-secondary-ink"
          onClick={startEditing}
        >
          编辑笔记
        </button>
        <button onClick={onCreatePuzzle}>从此局面创建题目</button>
      </div>
    </div>
  );
}
