import { useState } from "react";
import type { Move } from "../../shared/types";
import type { GameAnalysis } from "./game-analysis";
import { evaluationChartPath, evaluationChartPoints } from "./evaluation-chart";

export default function EvaluationChart({
  moves,
  initialFen,
  analysis,
  currentId,
  onSelect,
}: {
  moves: Move[];
  initialFen: string;
  analysis: GameAnalysis | null;
  currentId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const points = evaluationChartPoints(
    moves,
    initialFen,
    analysis?.positions ?? {},
  );
  const selected = points.findIndex((point) => point.id === currentId);
  const inspected = points[hovered ?? selected];
  const known = points.filter((point) => point.y !== null);
  const selectAt = (clientX: number, element: SVGSVGElement) => {
    const rect = element.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        moves.length,
        Math.round(((clientX - rect.left) / rect.width) * moves.length),
      ),
    );
  };
  return (
    <section
      className="shrink-0 rounded-nav border border-panel-edge bg-panel"
      aria-label="主线评分折线图"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1 text-caption text-engine-muted">
        <span className="shrink-0">主线评分 · 白方视角</span>
        <span className="truncate tabular-nums" aria-live="off">
          {inspected
            ? `${inspected.label} · ${inspected.evaluation?.label ?? "待分析"}`
            : "当前为分支局面"}
        </span>
      </div>
      <svg
        className="evaluation-chart-plot block w-full cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-focus"
        viewBox="-2 -3 1004 106"
        preserveAspectRatio="none"
        role="slider"
        tabIndex={0}
        aria-label="选择主线招法，左右方向键切换"
        aria-valuemin={0}
        aria-valuemax={moves.length}
        aria-valuenow={Math.max(0, selected)}
        aria-valuetext={
          selected < 0
            ? "当前为分支局面"
            : `${points[selected].label}，${points[selected].evaluation?.description ?? "待分析"}`
        }
        onPointerMove={(event) =>
          setHovered(selectAt(event.clientX, event.currentTarget))
        }
        onPointerLeave={() => setHovered(null)}
        onBlur={() => setHovered(null)}
        onClick={(event) =>
          onSelect(points[selectAt(event.clientX, event.currentTarget)].id)
        }
        onKeyDown={(event) => {
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? moves.length
                : event.key === "ArrowLeft"
                  ? Math.max(0, selected - 1)
                  : event.key === "ArrowRight"
                    ? Math.min(moves.length, selected + 1)
                    : null;
          if (index === null) return;
          event.preventDefault();
          setHovered(null);
          onSelect(points[index].id);
        }}
      >
        <rect
          width="1000"
          height="50"
          className="fill-evaluation-white opacity-10"
        />
        <rect
          y="50"
          width="1000"
          height="50"
          className="fill-evaluation-black"
        />
        <path
          d="M0,50 H1000"
          className="stroke-control-edge"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={evaluationChartPath(points)}
          fill="none"
          className="stroke-accent"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {known.map((point) => (
          <circle
            key={point.id ?? "initial"}
            cx={point.x}
            cy={point.y!}
            r="2"
            className="fill-accent"
          />
        ))}
        {selected >= 0 && (
          <path
            d={`M${points[selected].x},0 V100`}
            className="stroke-engine-muted"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hovered !== null && (
          <path
            d={`M${points[hovered].x},0 V100`}
            className="stroke-accent-ink"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="flex justify-between gap-2 px-3 py-1 text-caption text-engine-muted">
        <span>初始</span>
        <span className="truncate">
          {known.length === points.length
            ? "分析完成"
            : known.length
              ? `${analysis?.failed ? "分析中断 · " : ""}已分析 ${known.length} / ${points.length} 个局面`
              : analysis?.status || "等待引擎分析"}
        </span>
        <span className="shrink-0">{moves.length} 半回合</span>
      </div>
    </section>
  );
}
