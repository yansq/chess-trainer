import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { upcomingDueDays } from "./due-forecast";

export default function DueForecast({ refreshKey }: { refreshKey: number }) {
  const [forecast, setForecast] = useState<{
    dates: string[];
    counts: number[];
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const days = upcomingDueDays();
    api
      .getDueForecast(days.boundaries)
      .then((counts) => {
        if (counts.length !== 3) throw new Error("到期预告返回格式不正确");
        if (active) {
          setForecast({ dates: days.dates, counts });
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(`到期预告加载失败：${String(e)}`);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, retry]);
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
      aria-label="未来三天到期题目"
    >
      <span className="text-engine-muted">到期预告</span>
      {[1, 2, 3].map((day, index) => (
        <div
          key={day}
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={forecast?.dates[index]}
        >
          <span className="text-engine-muted">{day} 天后</span>
          <strong className="tabular-nums text-accent-ink">
            {error ? "—" : (forecast?.counts[index] ?? "—")} 道
          </strong>
        </div>
      ))}
      {error && (
        <span
          role="status"
          className="flex items-center gap-2 text-danger"
          title={error}
        >
          到期预告加载失败
          <button
            type="button"
            className="border-control-edge bg-secondary px-2 py-0.5 text-xs text-secondary-ink"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </button>
        </span>
      )}
    </div>
  );
}
