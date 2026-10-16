import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { uciLineToSan } from "../../shared/chess/moves";
import {
  PUZZLE_CATEGORIES,
  type Puzzle,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";
import { isMultiMovePuzzle, parsePuzzleAnswers } from "./answers";

export default function PuzzlesPage() {
  const [items, setItems] = useState<Puzzle[]>([]);
  const [category, setCategory] = useState<PuzzleCategory | "">("");
  const [editing, setEditing] = useState<Puzzle | null>(null);
  const [answers, setAnswers] = useState("");
  const [multiMove, setMultiMove] = useState(false);
  const [message, setMessage] = useState("");
  const nav = useNavigate();
  useEffect(() => {
    let active = true;
    api
      .listPuzzles(false, category || null)
      .then((puzzles) => {
        if (active) setItems(puzzles);
      })
      .catch((e) => {
        if (active) setMessage(String(e));
      });
    return () => {
      active = false;
    };
  }, [category]);

  function startEdit(p: Puzzle) {
    setEditing({ ...p });
    const multi = isMultiMovePuzzle(p);
    setMultiMove(multi);
    setAnswers(
      multi
        ? uciLineToSan(p.fen, p.solutionLine).join(" ")
        : p.expectedMoves
            .map((uci) => uciLineToSan(p.fen, [uci])[0] ?? uci)
            .join(", "),
    );
  }
  async function save() {
    if (!editing) return;
    try {
      const parsed = parsePuzzleAnswers(editing.fen, answers, multiMove);
      const updated = {
        ...editing,
        ...parsed,
        solutionLine:
          editing.sourceType === "auto"
            ? editing.solutionLine
            : parsed.solutionLine,
      };
      updated.title = await api.savePuzzle(updated);
      setItems((list) =>
        list
          .map((p) => (p.id === updated.id ? updated : p))
          .filter((p) => !category || p.category === category),
      );
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
        <div className="table-title flex flex-wrap items-center justify-between gap-3 border-b border-panel-edge px-5 py-3 text-[15px] font-bold">
          <div>
            {PUZZLE_CATEGORIES.find((option) => option.value === category)
              ?.label ?? "全部"}
            题目
            <span className="ml-2 text-[12px] font-normal text-engine-muted">
              {items.length} 道
            </span>
          </div>
          <Select<PuzzleCategory | "">
            label="筛选题目分类"
            value={category}
            onValueChange={setCategory}
            options={[{ value: "", label: "全部分类" }, ...PUZZLE_CATEGORIES]}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>题目</th>
              <th>分类</th>
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
                <td>
                  {
                    PUZZLE_CATEGORIES.find(
                      (option) => option.value === p.category,
                    )?.label
                  }
                </td>
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
            {category
              ? "该分类暂无题目。"
              : "题库为空。请到复盘页面，从一个局面创建题目。"}
          </div>
        )}
      </div>
      {editing && (
        <div className="panel puzzle-editor rounded-xl border border-panel-edge bg-panel mt-[18px] px-5 pb-5 [&>.section-title]:mx-[-20px] [&>.section-title]:mb-[18px] [&_label]:my-3 [&_label]:grid [&_label]:gap-[7px] [&_label]:text-[13px] [&>.settings-actions]:mt-[17px]">
          <div className="section-title border-b border-panel-edge px-[18px] py-4 text-[14px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
            编辑题目
          </div>
          <label>
            分类
            <Select<PuzzleCategory>
              label="编辑题目分类"
              value={editing.category}
              options={PUZZLE_CATEGORIES}
              onValueChange={(category) =>
                setEditing((p) => p && { ...p, category })
              }
            />
          </label>
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
          {editing.sourceType === "manual" && (
            <button
              type="button"
              role="switch"
              aria-checked={multiMove}
              className="secondary border-control-edge bg-secondary px-3 py-2 text-[12px] text-secondary-ink"
              onClick={() => setMultiMove((value) => !value)}
            >
              连续多步：{multiMove ? "开启" : "关闭"}
            </button>
          )}
          <label>
            {multiMove
              ? "连续走法（双方依次走棋，空格分隔）"
              : "正确招法（SAN / UCI，逗号分隔）"}
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={multiMove ? "e4 e5 Nf3" : "Nf3, d2d4"}
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
