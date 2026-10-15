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
    <div className="panel note-panel">
      <div className="section-title">
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
          <div className="row-end">
            <button onClick={() => void save()}>
              {temporary ? "暂存笔记" : "保存笔记"}
            </button>
          </div>
        </>
      ) : (
        <div className="note-preview" onClick={startEditing}>
          {content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <span className="muted">点击添加笔记…</span>
          )}
        </div>
      )}
      <div className="note-actions">
        <button className="secondary" onClick={startEditing}>
          编辑笔记
        </button>
        <button onClick={onCreatePuzzle}>从此局面创建题目</button>
      </div>
    </div>
  );
}
