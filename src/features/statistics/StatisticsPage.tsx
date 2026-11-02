import {
  Box,
  SegmentedControl,
  Callout,
  Card,
  Flex,
  Heading,
  Grid,
  Text,
  Table,
  TextField,
  Popover,
  Button,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api } from "../../shared/api";
import { GameSourceSelect } from "../../shared/ui/GameSourceSelect";
import type { GameSource, OpeningStat, OpponentType } from "../../shared/types";
import { OpponentTypeSelect } from "../../shared/ui/OpponentTypeSelect";
import { Select } from "../../shared/ui/select";
import {
  groupOpeningFamilies,
  type OpeningFamilyStat,
} from "./opening-families";
function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1)
    return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  const valid = isValidDate(draft);

  function update(next: string) {
    setDraft(next);
    if (!next || isValidDate(next)) onChange(next);
  }

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) return;
        if (value) {
          setDraft(value);
        } else {
          const now = new Date();
          update(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
          );
        }
      }}
    >
      <Popover.Trigger>
        <Button
          variant="surface"
          className="justify-start whitespace-nowrap [&_svg]:shrink-0"
        >
          <CalendarDays size={14} />
          {label}：{value || "不限"}
        </Button>
      </Popover.Trigger>
      <Popover.Content size="1">
        <Flex direction="column" gap="2">
          <Text size="2">{label}</Text>
          <Flex gap="2" align="center">
            <TextField.Root
              aria-label={label}
              placeholder="YYYY-MM-DD"
              value={draft}
              onChange={(e) => update(e.target.value)}
            />
            <Box className="relative">
              <input
                ref={picker}
                type="date"
                aria-label={`通过日历选择${label}`}
                tabIndex={-1}
                className="pointer-events-none absolute h-px w-px opacity-0"
                value={value}
                onInput={(e) => update(e.currentTarget.value)}
              />
              <Button
                variant="soft"
                aria-label={`打开${label}日历`}
                onClick={() => picker.current?.showPicker()}
              >
                <CalendarDays size={16} />
              </Button>
            </Box>
          </Flex>
          <Text size="1" color={draft && !valid ? "orange" : "gray"}>
            {draft && !valid
              ? "尚未应用，请输入有效日期（YYYY-MM-DD）。"
              : "可直接输入日期，例如 2026-07-01。"}
          </Text>
          <Popover.Close>
            <Button size="1" variant="soft" onClick={() => update("")}>
              不限日期
            </Button>
          </Popover.Close>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}

export default function StatisticsPage() {
  const [view, setView] = useState<"family" | "detail">("family");
  const [opponentType, setOpponentType] = useState<OpponentType>("human");
  const [source, setSource] = useState<GameSource | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stats, setStats] = useState<OpeningStat[]>([]);
  const [error, setError] = useState("");
  const rows: (OpeningFamilyStat & { eco?: string })[] =
    view === "family" ? groupOpeningFamilies(stats) : stats;
  const isFamily = view === "family";
  const overall = stats.reduce(
    (sum, stat) => ({
      total: sum.total + stat.total,
      wins: sum.wins + stat.wins,
      draws: sum.draws + stat.draws,
    }),
    { total: 0, wins: 0, draws: 0 },
  );
  const { total, wins, draws } = overall;
  const score = wins + draws * 0.5;
  useEffect(() => {
    let active = true;
    api
      .openingStats(
        color,
        speed,
        from || null,
        to ? `${to}T23:59:59Z` : null,
        opponentType,
        source,
      )
      .then((result) => {
        if (active) {
          setStats(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [color, speed, from, to, opponentType, source]);
  return (
    <>
      <Flex
        align="center"
        justify="between"
        mb="5"
        gap="5"
        className="[&_p]:m-0 [&_p]:text-sm [&_p]:text-description"
      >
        <Box>
          <Heading as="h1" size="7">
            开局统计
          </Heading>
          <Text as="p" size="2" color="gray">
            仅统计本人对局。
          </Text>
        </Box>
        <SegmentedControl.Root
          value={view}
          onValueChange={(value) => setView(value as "family" | "detail")}
          aria-label="开局统计维度"
        >
          <SegmentedControl.Item value="family">大类</SegmentedControl.Item>
          <SegmentedControl.Item value="detail">细分</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>
      {error && (
        <Callout.Root size="1" className="mb-5">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      <Card className="mb-5 flex flex-wrap gap-3 p-4 [&>*]:min-w-max [&>*]:flex-1">
        <GameSourceSelect value={source} onChange={setSource} />
        <OpponentTypeSelect value={opponentType} onChange={setOpponentType} />
        <Select
          label="执棋颜色"
          value={color ?? ""}
          onValueChange={(color) => setColor(color || null)}
          options={[
            { value: "", label: "全部执棋" },
            { value: "white", label: "白方" },
            { value: "black", label: "黑方" },
          ]}
        />
        <Select
          label="对局时限"
          value={speed ?? ""}
          onValueChange={(speed) => setSpeed(speed || null)}
          options={[
            { value: "", label: "全部时限" },
            { value: "bullet", label: "Bullet" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
            { value: "correspondence", label: "通信棋" },
          ]}
        />
        {[
          { label: "开始日期", value: from, setValue: setFrom },
          { label: "结束日期", value: to, setValue: setTo },
        ].map(({ label, value, setValue }) => (
          <DateFilter
            key={label}
            label={label}
            value={value}
            onChange={setValue}
          />
        ))}
      </Card>
      <Grid
        columns={{ initial: "1", sm: "2" }}
        gap="3"
        mb="4"
        aria-label="当前筛选整体统计"
      >
        <Card size="2" aria-label="整体胜率">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              整体胜率
            </Text>
            <Heading size="7" className="tabular-nums">
              {total && !error ? `${((wins / total) * 100).toFixed(1)}%` : "—"}
            </Heading>
            <Text size="1" color="gray">
              {error
                ? "统计加载失败"
                : total
                  ? `${wins} 胜 / ${total} 局`
                  : "暂无对局"}
            </Text>
          </Flex>
        </Card>
        <Card size="2" aria-label="整体得分率">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              整体得分率
            </Text>
            <Heading size="7" className="tabular-nums">
              {total && !error ? `${((score / total) * 100).toFixed(1)}%` : "—"}
            </Heading>
            <Text
              size="1"
              color="gray"
              title="每胜计 1 分、每和计 0.5 分、每负计 0 分"
            >
              {error
                ? "统计加载失败"
                : total
                  ? `${score} 分 / ${total} 局 · 和棋计 0.5 分`
                  : "暂无对局"}
            </Text>
          </Flex>
        </Card>
      </Grid>
      <Card className="overflow-hidden p-0">
        <Box className="border-b border-panel-edge px-5 py-4 text-body font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          {isFamily ? "开局大类" : "开局细分"}
          <span>
            {rows.length} {isFamily ? "类" : "项"} · {total} 局
          </span>
        </Box>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              {!isFamily && (
                <Table.ColumnHeaderCell>ECO</Table.ColumnHeaderCell>
              )}
              <Table.ColumnHeaderCell>
                {isFamily ? "开局大类" : "开局"}
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                样本
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">胜</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">和</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">负</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                胜率
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                得分率
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((s) => (
              <Table.Row key={isFamily ? s.opening : `${s.eco}-${s.opening}`}>
                {!isFamily && <Table.Cell>{s.eco}</Table.Cell>}
                <Table.Cell>{s.opening}</Table.Cell>
                <Table.Cell justify="end">{s.total}</Table.Cell>
                <Table.Cell justify="end">{s.wins}</Table.Cell>
                <Table.Cell justify="end">{s.draws}</Table.Cell>
                <Table.Cell justify="end">{s.losses}</Table.Cell>
                <Table.Cell justify="end">
                  {(s.winRate * 100).toFixed(1)}%
                </Table.Cell>
                <Table.Cell justify="end">
                  {(s.scoreRate * 100).toFixed(1)}%
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {rows.length === 0 && (
          <Box className="px-5 py-15 text-center text-empty">
            暂无可统计的对局。
          </Box>
        )}
      </Card>
    </>
  );
}
