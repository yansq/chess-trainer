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
} from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import type { OpeningStat, OpponentType } from "../../shared/types";
import { OpponentTypeSelect } from "../../shared/ui/OpponentTypeSelect";
import { Select } from "../../shared/ui/select";
import {
  groupOpeningFamilies,
  type OpeningFamilyStat,
} from "./opening-families";
export default function StatisticsPage() {
  const [view, setView] = useState<"family" | "detail">("family");
  const [opponentType, setOpponentType] = useState<OpponentType>("human");
  const [color, setColor] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stats, setStats] = useState<OpeningStat[]>([]);
  const [error, setError] = useState("");
  const families = useMemo(() => groupOpeningFamilies(stats), [stats]);
  const rows: (OpeningFamilyStat & { eco?: string })[] =
    view === "family" ? families : stats;
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
  }, [color, speed, from, to, opponentType]);
  return (
    <>
      <Flex
        align="center"
        justify="between"
        mb="7"
        gap="5"
        className="[&_p]:m-0 [&_p]:text-sm [&_p]:text-description"
      >
        <Box>
          <Box className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            PERFORMANCE
          </Box>
          <Heading as="h1" size="8">
            开局统计
          </Heading>
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
        <Callout.Root size="1" className="mb-4.5">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      <Card className="mb-4.5 flex flex-wrap gap-2.5 p-3.5 [&>*]:min-w-31.25 [&>*]:flex-1">
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
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
          ]}
        />
        <TextField.Root
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField.Root
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
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
        <Box className="border-b border-panel-edge px-5 py-4.25 text-body font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
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
              <Table.ColumnHeaderCell>样本</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>胜</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>和</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>负</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>胜率</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>得分率</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((s) => (
              <Table.Row key={isFamily ? s.opening : `${s.eco}-${s.opening}`}>
                {!isFamily && <Table.Cell>{s.eco}</Table.Cell>}
                <Table.Cell>{s.opening}</Table.Cell>
                <Table.Cell>{s.total}</Table.Cell>
                <Table.Cell>{s.wins}</Table.Cell>
                <Table.Cell>{s.draws}</Table.Cell>
                <Table.Cell>{s.losses}</Table.Cell>
                <Table.Cell>{(s.winRate * 100).toFixed(1)}%</Table.Cell>
                <Table.Cell>{(s.scoreRate * 100).toFixed(1)}%</Table.Cell>
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
