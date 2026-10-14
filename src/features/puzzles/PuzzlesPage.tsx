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
      <div className="page-head">
        <div>
          <div className="eyebrow">PUZZLE LIBRARY</div>
          <h1>题库</h1>
        </div>
        <button onClick={() => nav("/review")}>开始今日训练</button>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="panel table-wrap">
        <div className="table-title">
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
                  <button className="secondary" onClick={() => startEdit(p)}>
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="empty">
            题库为空。请到复盘页面，从一个局面创建题目。
          </div>
        )}
      </div>
      {editing && (
        <div className="panel puzzle-editor">
          <div className="section-title">编辑题目</div>
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
          <div className="settings-actions">
            <button onClick={() => void save()}>保存修改</button>
            <button className="secondary" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}
