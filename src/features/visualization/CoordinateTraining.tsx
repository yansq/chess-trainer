import { useEffect, useReducer } from "react";
import { Box, Button, Card, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import {
  coordinateSession,
  coordinateSquares,
  initialCoordinateSession,
} from "./coordinates";

export default function CoordinateTraining() {
  const [session, dispatch] = useReducer(
    coordinateSession,
    initialCoordinateSession,
  );
  const running = session.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => dispatch({ type: "tick", now: performance.now() }),
      100,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  return (
    <Card size="3">
      <Heading as="h2" size="5">
        棋盘坐标
      </Heading>
      <Text as="p" size="2" color="gray">
        找到给出的坐标，点击对应格子。答对后自动进入下一个坐标，答错可重试，30
        秒结束后统计成绩。
      </Text>
      <Grid gap="5" className="grid-cols-2 max-[760px]:grid-cols-1">
        <div
          className="grid w-full max-w-112 grid-cols-8 overflow-hidden rounded-nav border-4 border-board-frame"
          role="group"
          aria-label="无坐标棋盘，白方视角，左下角为 a1"
        >
          {coordinateSquares.map((square, index) => (
            <button
              type="button"
              key={square}
              aria-label={square}
              disabled={!running}
              onClick={() =>
                dispatch({
                  type: "answer",
                  square,
                  now: performance.now(),
                  random: Math.random(),
                })
              }
              className={`aspect-square min-w-0 cursor-pointer focus-visible:z-10 focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-focus disabled:cursor-default ${((index % 8) + Math.floor(index / 8)) % 2 ? "bg-board-dark" : "bg-board-light"} ${session.wrong === square ? "ring-4 ring-danger ring-inset" : ""}`}
            />
          ))}
        </div>
        <Flex direction="column" align="start" gap="4">
          <Text size="2" color="gray">
            白方视角 · 棋盘不显示坐标
          </Text>
          <Flex gap="5" wrap="wrap">
            <Box>
              <Text as="div" size="2" color="gray">
                剩余时间
              </Text>
              <Text
                as="div"
                size="7"
                className="tabular-nums"
                aria-label="剩余秒数"
              >
                {Math.ceil(session.remaining / 1000)} 秒
              </Text>
            </Box>
            <Box>
              <Text as="div" size="2" color="gray">
                正确个数
              </Text>
              <Text
                as="div"
                size="7"
                className="tabular-nums"
                aria-label="正确个数"
              >
                {session.score}
              </Text>
            </Box>
          </Flex>
          {running && (
            <Box>
              <Text as="div" size="2" color="gray">
                请点击
              </Text>
              <Text
                as="div"
                size="9"
                weight="bold"
                className="font-chess-mono"
                aria-label="目标坐标"
                aria-live="polite"
              >
                {session.target}
              </Text>
            </Box>
          )}
          <Text as="p" size="2" role="status" className="min-h-10">
            {session.status === "finished"
              ? `训练结束！30 秒内答对 ${session.score} 个坐标。`
              : session.wrong
                ? "不对，再试一次。"
                : running
                  ? "点击棋盘上的目标格子。"
                  : "点击开始，准备好后再计时。"}
          </Text>
          <Button
            disabled={running}
            onClick={() =>
              dispatch({
                type: "start",
                now: performance.now(),
                random: Math.random(),
              })
            }
          >
            {session.status === "idle"
              ? "开始训练"
              : running
                ? "训练中…"
                : "再练一次"}
          </Button>
        </Flex>
      </Grid>
    </Card>
  );
}
