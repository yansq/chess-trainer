import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Table,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import {
  PUZZLE_CATEGORIES,
  type PuzzleListItem,
  type PuzzleCategory,
} from "../../shared/types";
import { Select } from "../../shared/ui/select";

export default function PuzzlesPage() {
  const [items, setItems] = useState<PuzzleListItem[]>([]);
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
      <Flex
        align="center"
        justify="between"
        mb="7"
        gap="5"
        className="[&_p]:m-0 [&_p]:text-sm [&_p]:text-description"
      >
        <Box>
          <Box className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            PUZZLE LIBRARY
          </Box>
          <Heading as="h1" size="8">
            题库
          </Heading>
        </Box>
        <Flex wrap="wrap" gap="2">
          <Button size="1" variant="soft" onClick={() => nav("/puzzles/new")}>
            新建题目
          </Button>
          <Button size="1" variant="solid" onClick={() => nav("/review")}>
            开始今日训练
          </Button>
        </Flex>
      </Flex>
      {message && (
        <Callout.Root size="1" className="mb-4.5">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      <Card className="overflow-hidden p-0">
        <Flex
          wrap="wrap"
          align="center"
          justify="between"
          gap="3"
          px="5"
          py="3"
          className="border-b border-panel-edge text-body font-bold"
        >
          <Box>
            {PUZZLE_CATEGORIES.find((option) => option.value === category)
              ?.label ?? "全部"}
            题目
            <span className="ml-2 text-xs font-normal text-engine-muted">
              {items.length} 道
            </span>
          </Box>
          <Select<PuzzleCategory | "">
            label="筛选题目分类"
            value={category}
            onValueChange={setCategory}
            options={[{ value: "", label: "全部分类" }, ...PUZZLE_CATEGORIES]}
          />
        </Flex>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>题目</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>分类</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>答题方</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>来源</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>到期时间</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((p) => (
              <Table.Row
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
                <Table.Cell>{p.title}</Table.Cell>
                <Table.Cell>
                  {
                    PUZZLE_CATEGORIES.find(
                      (option) => option.value === p.category,
                    )?.label
                  }
                </Table.Cell>
                <Table.Cell>
                  {p.sideToMove === "white" ? "白方" : "黑方"}
                </Table.Cell>
                <Table.Cell>{p.sourceGameId ?? "独立题目"}</Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">
                  {p.dueAt && !Number.isNaN(Date.parse(p.dueAt)) ? (
                    <time dateTime={p.dueAt}>
                      {new Date(p.dueAt).toLocaleString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </time>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        {items.length === 0 && (
          <Box className="px-5 py-15 text-center text-empty">
            {category
              ? "该分类暂无题目。"
              : "题库为空。点击“新建题目”，或到复盘页面从局面创建题目。"}
          </Box>
        )}
      </Card>
    </>
  );
}
