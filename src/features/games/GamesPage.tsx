import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Table,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, RefreshCw, Pause } from "lucide-react";
import { api } from "../../shared/api";
import type { GameFilter, GamePage } from "../../shared/types";
import { parsePgnCollection } from "./pgn";
import { OpponentTypeSelect } from "../../shared/ui/OpponentTypeSelect";
import { Select } from "../../shared/ui/select";
import { useLichessSync } from "./sync-store";
const initial: GameFilter = {
  opponentType: "human",
  color: null,
  result: null,
  speed: null,
  reviewed: null,
  opening: null,
  limit: 25,
  offset: 0,
};
function resultLabel(result: string, color: string | null) {
  if (result === "draw") return "和";
  if (!color || result === "unknown") return "未知";
  return result === color ? "胜" : "负";
}
export default function GamesPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const [filter, setFilter] = useState(initial);
  const [page, setPage] = useState<GamePage>({ items: [], total: 0 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sync = useLichessSync();
  const refreshSync = sync.refresh;
  useEffect(() => {
    api
      .listGames(filter)
      .then(setPage)
      .catch((e) => setMessage(String(e)));
  }, [filter, sync.revision]);
  useEffect(() => {
    void refreshSync();
  }, [refreshSync]);
  async function importFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const username = await api.getSetting("lichess_username");
      const games = parsePgnCollection(text, "local", username ?? undefined);
      const added = await api.importGames(games);
      setMessage(`已读取 ${games.length} 局，新增 ${added} 局`);
      setPage(await api.listGames(filter));
    } catch (e) {
      setMessage(`导入失败：${e}`);
    } finally {
      setBusy(false);
    }
  }
  const change = (patch: Partial<GameFilter>) =>
    setFilter((f) => ({ ...f, ...patch, offset: 0 }));
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
            YOUR GAMES
          </Box>
          <Heading as="h1" size="8">
            对局
          </Heading>
        </Box>
        <Flex className="gap-2.5">
          <Button
            variant="soft"
            disabled={busy || sync.running}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} /> 导入 PGN
          </Button>
          <input
            ref={fileInput}
            hidden
            disabled={busy || sync.running}
            type="file"
            accept=".pgn,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
          <Button
            size="2"
            variant="solid"
            type="button"
            className="w-36 shrink-0"
            disabled={busy || sync.pausing}
            onClick={() => {
              if (sync.running) sync.pause();
              else void sync.start();
            }}
          >
            {sync.running ? <Pause size={16} /> : <RefreshCw size={16} />}
            {sync.pausing
              ? "正在暂停…"
              : sync.running
                ? "暂停同步"
                : sync.checkpoint?.pending
                  ? "继续同步"
                  : "同步对局"}
          </Button>
        </Flex>
      </Flex>
      {message && (
        <Callout.Root size="1" className="mb-4.5">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      {sync.message && (
        <Callout.Root size="1" className="mb-4.5" role="status">
          <Callout.Text>{sync.message}</Callout.Text>
        </Callout.Root>
      )}
      <Card className="mb-4.5 flex flex-wrap gap-2.5 p-3.5 [&>*]:min-w-31.25 [&>*]:flex-1">
        <OpponentTypeSelect
          value={filter.opponentType}
          onChange={(opponentType) => change({ opponentType })}
        />
        <Select
          label="执棋颜色"
          value={filter.color ?? ""}
          onValueChange={(color) => change({ color: color || null })}
          options={[
            { value: "", label: "全部执棋" },
            { value: "white", label: "白方" },
            { value: "black", label: "黑方" },
          ]}
        />
        <Select
          label="对局结果"
          value={filter.result ?? ""}
          onValueChange={(result) => change({ result: result || null })}
          options={[
            { value: "", label: "全部结果" },
            { value: "win", label: "胜" },
            { value: "draw", label: "和" },
            { value: "loss", label: "负" },
          ]}
        />
        <Select
          label="复盘状态"
          value={filter.reviewed === null ? "" : String(filter.reviewed)}
          onValueChange={(reviewed) =>
            change({ reviewed: reviewed === "" ? null : reviewed === "true" })
          }
          options={[
            { value: "", label: "全部状态" },
            { value: "false", label: "未复盘" },
            { value: "true", label: "已复盘" },
          ]}
        />
        <Select
          label="对局时限"
          value={filter.speed ?? ""}
          onValueChange={(speed) => change({ speed: speed || null })}
          options={[
            { value: "", label: "全部时限" },
            { value: "bullet", label: "Bullet" },
            { value: "blitz", label: "Blitz" },
            { value: "rapid", label: "Rapid" },
            { value: "classical", label: "Classical" },
          ]}
        />
        <TextField.Root
          placeholder="搜索 ECO / 开局"
          value={filter.opening ?? ""}
          onChange={(e) => change({ opening: e.target.value || null })}
        />
      </Card>
      <Card className="overflow-hidden p-0">
        <Box className="border-b border-panel-edge px-5 py-4.25 text-body font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          对局记录 <span>{page.total} 局</span>
        </Box>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>日期</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>对手</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>执棋</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>结果</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>开局</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>时限</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {page.items.map((g) => (
              <Table.Row
                data-interactive
                key={g.id}
                onClick={() => nav(`/analysis/${encodeURIComponent(g.id)}`)}
              >
                <Table.Cell>{g.playedAt?.slice(0, 10) ?? "—"}</Table.Cell>
                <Table.Cell>
                  {g.userColor === "white" ? g.blackPlayer : g.whitePlayer}
                </Table.Cell>
                <Table.Cell>{g.userColor === "white" ? "白" : "黑"}</Table.Cell>
                <Table.Cell>
                  <Badge
                    color={
                      resultLabel(g.result, g.userColor) === "胜"
                        ? "green"
                        : resultLabel(g.result, g.userColor) === "负"
                          ? "red"
                          : "gray"
                    }
                  >
                    {resultLabel(g.result, g.userColor)}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {g.eco ?? "—"} · {g.openingName ?? "未知开局"}
                </Table.Cell>
                <Table.Cell>{g.speed ?? "—"}</Table.Cell>
                <Table.Cell>{g.reviewStatus ? "已复盘" : "待复盘"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {page.items.length === 0 && (
          <Box className="px-5 py-15 text-center text-empty">
            当前筛选下暂无对局。可调整筛选、导入 PGN 或同步 Lichess。
          </Box>
        )}
        <Flex
          align="center"
          justify="end"
          className="gap-3.5 border-t border-panel-edge px-4.5 py-3.25 text-xs text-preview"
        >
          <Button
            size="1"
            variant="soft"
            disabled={filter.offset === 0}
            onClick={() =>
              setFilter((f) => ({ ...f, offset: f.offset - f.limit }))
            }
          >
            上一页
          </Button>
          <span>
            {page.total ? Math.floor(filter.offset / filter.limit) + 1 : 0} /{" "}
            {Math.ceil(page.total / filter.limit)}
          </span>
          <Button
            size="1"
            variant="soft"
            disabled={filter.offset + filter.limit >= page.total}
            onClick={() =>
              setFilter((f) => ({ ...f, offset: f.offset + f.limit }))
            }
          >
            下一页
          </Button>
        </Flex>
      </Card>
    </>
  );
}
