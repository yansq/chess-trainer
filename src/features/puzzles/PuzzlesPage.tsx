import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import {
  PUZZLE_CATEGORIES,
  type Puzzle,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";

export default function PuzzlesPage() {
  const [items, setItems] = useState<Puzzle[]>([]);
  const [category, setCategory] = useState<PuzzleCategory | "">("");
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
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr
                key={p.id}
                tabIndex={0}
                aria-label={`编辑题目：${p.title}`}
                className="focus-visible:outline-2 focus-visible:outline-accent-ink focus-visible:-outline-offset-2"
                onClick={() => nav(`/puzzles/${encodeURIComponent(p.id)}/edit`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    nav(`/puzzles/${encodeURIComponent(p.id)}/edit`);
                  }
                }}
              >
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
    </>
  );
}
