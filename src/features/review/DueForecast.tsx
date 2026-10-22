import { Box, Button, Flex } from "@radix-ui/themes";
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
    <Flex
      wrap="wrap"
      align="center"
      mb="3"
      className="gap-x-4 gap-y-1 text-xs"
      aria-label="未来三天到期题目"
    >
      {[1, 2, 3].map((day, index) => (
        <Box
          key={day}
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={
            forecast
              ? `截至 ${forecast.dates[index]} 当天结束，包含今天及已逾期的题目`
              : "累计到期题数，包含今天及已逾期的题目"
          }
        >
          <span className="text-engine-muted">{day} 天后</span>
          <strong className="tabular-nums text-accent-ink">
            {error ? "—" : (forecast?.counts[index] ?? "—")} 题
          </strong>
        </Box>
      ))}
      {error && (
        <span
          role="status"
          className="flex items-center gap-2 text-danger"
          title={error}
        >
          到期预告加载失败
          <Button
            size="1"
            variant="soft"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </Button>
        </span>
      )}
    </Flex>
  );
}
