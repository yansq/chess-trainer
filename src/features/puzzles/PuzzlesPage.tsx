import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Table,
  TextField,
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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 10;
  const pageCount = Math.ceil(total / pageSize);
  function changePage(next: number) {
    setLoading(true);
    setPage(next);
  }
  const [message, setMessage] = useState("");
  const nav = useNavigate();
  useEffect(() => {
    let active = true;
    api
      .puzzlePage(category || null, pageSize, (page - 1) * pageSize)
      .then((puzzles) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(puzzles.total / pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setItems(puzzles.items);
        setTotal(puzzles.total);
        setMessage("");
        setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setMessage(String(e));
          setItems([]);
          setTotal(0);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [category, page]);

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
        <Callout.Root size="1" className="mb-5">
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
              {total} 道
            </span>
          </Box>
          <Select<PuzzleCategory | "">
            label="筛选题目分类"
            value={category}
            onValueChange={(value) => {
              if (value !== category) {
                setLoading(true);
                setCategory(value);
                setPage(1);
              }
            }}
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
            {(loading ? [] : items).map((p) => (
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
        {!loading && items.length === 0 && (
          <Box className="px-5 py-15 text-center text-empty">
            {category
              ? "该分类暂无题目。"
              : "题库为空。点击“新建题目”，或到复盘页面从局面创建题目。"}
          </Box>
        )}
        {loading && (
          <Box role="status" className="px-5 py-4 text-muted">
            正在加载题目…
          </Box>
        )}
        <Flex
          align="center"
          justify="end"
          wrap="wrap"
          className="gap-4 border-t border-panel-edge px-5 py-3 text-xs text-preview"
        >
          <Button
            size="2"
            variant="soft"
            disabled={loading || page <= 1}
            onClick={() => changePage(page - 1)}
          >
            上一页
          </Button>
          <span>
            {total ? page : 0} / {pageCount}
          </span>
          <Button
            size="2"
            variant="soft"
            disabled={loading || page >= pageCount}
            onClick={() => changePage(page + 1)}
          >
            下一页
          </Button>
          <Flex asChild align="center" gap="2">
            <form
              aria-label="题库页码跳转"
              onSubmit={(event) => {
                event.preventDefault();
                const next = Number(
                  new FormData(event.currentTarget).get("page"),
                );
                if (
                  !loading &&
                  Number.isSafeInteger(next) &&
                  next >= 1 &&
                  next <= pageCount &&
                  next !== page
                )
                  changePage(next);
              }}
            >
              <span>跳至</span>
              <TextField.Root
                key={`${page}:${pageCount}`}
                aria-label="跳转页码"
                name="page"
                type="number"
                size="2"
                className="w-20"
                min={1}
                max={Math.max(1, pageCount)}
                step={1}
                required
                defaultValue={total ? page : ""}
                disabled={loading || !pageCount}
              />
              <span>页</span>
              <Button
                size="2"
                variant="soft"
                type="submit"
                disabled={loading || !pageCount}
              >
                跳转
              </Button>
            </form>
          </Flex>
        </Flex>
      </Card>
    </>
  );
}
