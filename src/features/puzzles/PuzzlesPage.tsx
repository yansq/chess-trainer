import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { normalizeAnswer } from "../../shared/chess/moves";
import type { Puzzle } from "../../shared/types";

export default function PuzzlesPage() {
  const [items, setItems] = useState<Puzzle[]>([]);
  const [editing, setEditing] = useState<Puzzle | null>(null);
  const [answers, setAnswers] = useState("");
  const [message, setMessage] = useState("");
  const nav = useNavigate();
  useEffect(() => {
    api
      .listPuzzles(false)
      .then(setItems)
      .catch((e) => setMessage(String(e)));
  }, []);

  function startEdit(p: Puzzle) {
    setEditing({ ...p });
    setAnswers(p.expectedMoves.join(", "));
  }
  async function save() {
    if (!editing) return;
    const raw = answers.split(/[,，\s]+/).filter(Boolean);
    const moves = raw.map((a) => normalizeAnswer(editing.fen, a));
    if (!moves.length || moves.some((a) => !a)) {
      setMessage("至少填写一步合法的 SAN 或 UCI 招法");
      return;
    }
    try {
      const updated = { ...editing, expectedMoves: moves as string[] };
      await api.savePuzzle(updated);
      setItems((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      setEditing(null);
      setMessage("题目已更新");
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <>
      <div className="page-head mb-7 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-[14px] [&_p]:text-[#8d9e9b]">
        <div>
          <div className="eyebrow text-[10px] font-[750] tracking-[0.2em] text-[#81ad94]">
            PUZZLE LIBRARY
          </div>
          <h1>题库</h1>
        </div>
        <button onClick={() => nav("/review")}>开始今日训练</button>
      </div>
      {message && (
        <div className="notice mb-[18px] rounded-lg border border-[#456457] bg-[#22392e] px-[15px] py-3 text-[13px] text-[#cce9d4]">
          {message}
        </div>
      )}
      <div className="panel table-wrap rounded-xl border border-panel-edge bg-panel overflow-hidden">
        <div className="table-title border-b border-panel-edge px-5 py-[17px] text-[15px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
          全部题目 <span>{items.length} 道</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>题目</th>
              <th>答题方</th>
              <th>来源</th>
              <th>类型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.sideToMove === "white" ? "白方" : "黑方"}</td>
                <td>{p.sourceGameId ?? "独立题目"}</td>
                <td>{p.sourceType === "manual" ? "手动" : "自动"}</td>
                <td>
                  <button
                    className="secondary border-control-edge bg-secondary text-secondary-ink"
                    onClick={() => startEdit(p)}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="empty px-5 py-[60px] text-center text-[#829591]">
            题库为空。请到复盘页面，从一个局面创建题目。
          </div>
        )}
      </div>
      {editing && (
        <div className="panel puzzle-editor rounded-xl border border-panel-edge bg-panel mt-[18px] px-5 pb-5 [&>.section-title]:mx-[-20px] [&>.section-title]:mb-[18px] [&_label]:my-3 [&_label]:grid [&_label]:gap-[7px] [&_label]:text-[13px] [&>.settings-actions]:mt-[17px]">
          <div className="section-title border-b border-panel-edge px-[18px] py-4 text-[14px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
            编辑题目
          </div>
          <label>
            标题
            <input
              value={editing.title}
              onChange={(e) =>
                setEditing((v) => v && { ...v, title: e.target.value })
              }
            />
          </label>
          <label>
            说明
            <textarea
              rows={3}
              value={editing.description}
              onChange={(e) =>
                setEditing((v) => v && { ...v, description: e.target.value })
              }
            />
          </label>
          <label>
            正确招法（SAN / UCI，逗号分隔）
            <input
              value={answers}
              onChange={(e) => setAnswers(e.target.value)}
            />
          </label>
          <div className="settings-actions mt-[18px] flex gap-2.5">
            <button onClick={() => void save()}>保存修改</button>
            <button
              className="secondary border-control-edge bg-secondary text-secondary-ink"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}
