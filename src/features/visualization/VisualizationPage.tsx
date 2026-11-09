import { useState } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Text,
  TextField,
  SegmentedControl,
} from "@radix-ui/themes";
import { ChessKnight, RefreshCw } from "lucide-react";
import {
  randomKnightExercise,
  validateKnightPath,
  type KnightResult,
} from "./knight";

import CoordinateTraining from "./CoordinateTraining";

export default function VisualizationPage() {
  const [training, setTraining] = useState("knight");
  const [exercise, setExercise] = useState(randomKnightExercise);
  const [path, setPath] = useState("");
  const [result, setResult] = useState<KnightResult | null>(null);
  const [revealed, setRevealed] = useState(false);

  function nextExercise() {
    setExercise(randomKnightExercise());
    setPath("");
    setResult(null);
    setRevealed(false);
  }

  return (
    <Box className="mx-auto w-full max-w-240">
      <Box mb="6">
        <Heading as="h1" size="7">
          可视化训练
        </Heading>
        <Text as="p" size="2" color="gray">
          在脑中构建棋盘，练习坐标、棋子移动与路径推演。
        </Text>
      </Box>
      <SegmentedControl.Root
        value={training}
        onValueChange={setTraining}
        mb="4"
        aria-label="选择可视化训练"
      >
        <SegmentedControl.Item value="knight">盲马</SegmentedControl.Item>
        <SegmentedControl.Item value="coordinates">
          棋盘坐标
        </SegmentedControl.Item>
      </SegmentedControl.Root>
      {training === "coordinates" ? (
        <CoordinateTraining />
      ) : (
        <Card size="3">
          <Flex align="center" gap="3">
            <ChessKnight size={24} aria-hidden="true" />
            <Box>
              <Heading as="h2" size="5">
                盲马
              </Heading>
              <Text as="p" size="2" color="gray" className="m-0">
                不看棋盘，让马以尽可能少的步数到达终点。
              </Text>
            </Box>
          </Flex>
          <Grid columns="2" gap="3" my="5" aria-label="本题坐标">
            {[
              { label: "起点", square: exercise.from },
              { label: "终点", square: exercise.to },
            ].map(({ label, square }) => (
              <Box
                key={label}
                className="rounded-lg border border-control-edge p-4"
              >
                <Text as="div" size="2" color="gray">
                  {label}
                </Text>
                <Text
                  as="div"
                  size="8"
                  weight="bold"
                  className="font-mono"
                  aria-label={`${label} ${square}`}
                >
                  {square}
                </Text>
              </Box>
            ))}
          </Grid>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setResult(validateKnightPath(exercise, path));
              setRevealed(false);
            }}
          >
            <Text as="label" htmlFor="knight-path" size="2" weight="medium">
              马的路径
            </Text>
            <TextField.Root
              id="knight-path"
              aria-describedby="knight-path-help"
              size="3"
              className="mt-2 font-mono"
              placeholder="输入经过的坐标，以终点结束"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setResult(null);
                setRevealed(false);
              }}
            />
            <Text as="p" id="knight-path-help" size="2" color="gray">
              相邻坐标用空格、逗号或 →
              分隔，可包含起点，也可从第一步的落点开始。按空棋盘计算，每步必须走合法马步。
            </Text>
            <Flex gap="3" wrap="wrap" mt="4">
              <Button type="submit" disabled={!path.trim()}>
                校验路径
              </Button>
              <Button type="button" variant="soft" onClick={nextExercise}>
                <RefreshCw size={16} />
                换一题
              </Button>
            </Flex>
          </form>
          {result && (
            <Box mt="5">
              <Callout.Root
                role="status"
                color={
                  result.verdict === "最佳"
                    ? "green"
                    : result.verdict === "非最佳"
                      ? "orange"
                      : "red"
                }
              >
                <Callout.Text>
                  <Text as="span" weight="bold">
                    {result.verdict}
                  </Text>
                  <Text as="span" className="block" mt="1">
                    {result.detail}
                  </Text>
                  {result.verdict !== "不合法" && (
                    <Text as="span" className="block" mt="1">
                      你的路径：{result.steps} 步 · 最短路径：
                      {result.shortestPath.length - 1} 步
                    </Text>
                  )}
                </Callout.Text>
              </Callout.Root>
              {revealed ? (
                <Box
                  mt="3"
                  className="whitespace-pre-wrap wrap-anywhere text-sm"
                  aria-label="一条最短路径"
                >
                  一条最短路径：{result.shortestPath.join(" → ")}
                </Box>
              ) : (
                <Button
                  type="button"
                  size="1"
                  variant="ghost"
                  mt="3"
                  onClick={() => setRevealed(true)}
                >
                  查看一条最短路径
                </Button>
              )}
            </Box>
          )}
        </Card>
      )}
    </Box>
  );
}
