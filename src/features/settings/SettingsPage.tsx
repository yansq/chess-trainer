import {
  getEngineDepth,
  normalizeEngineDepth,
} from "../analysis/engine-settings";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import SoundSettings from "./SoundSettings";
import UpdateSettings from "../updates/UpdateSettings";

type AccountFeedbackState = {
  action: "save" | "test" | "token";
  status: "pending" | "success" | "error";
  text: string;
};

function AccountFeedback({
  feedback,
}: {
  feedback: AccountFeedbackState | null;
}) {
  return (
    feedback && (
      <Callout.Root
        size="1"
        color={
          feedback.status === "error"
            ? "red"
            : feedback.status === "success"
              ? "green"
              : "gray"
        }
        role={feedback.status === "error" ? "alert" : "status"}
        aria-live={feedback.status === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <Callout.Text>{feedback.text}</Callout.Text>
      </Callout.Root>
    )
  );
}

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [chessComUsername, setChessComUsername] = useState("");
  const [token, setToken] = useState("");
  const [enginePath, setEnginePath] = useState("");
  const [preanalysisDepth, setPreanalysisDepth] = useState("14");
  const [positionDepth, setPositionDepth] = useState("14");
  const [threads, setThreads] = useState("4");
  const [hashMb, setHashMb] = useState("256");
  const [thresholds, setThresholds] = useState({
    inaccuracy: 12,
    mistake: 25,
    blunder: 40,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lichessFeedback, setLichessFeedback] =
    useState<AccountFeedbackState | null>(null);
  const [chessFeedback, setChessFeedback] =
    useState<AccountFeedbackState | null>(null);

  useEffect(() => {
    api
      .getSetting("lichess_username")
      .then((v) => setUsername(v ?? ""))
      .catch((e) => setMessage(String(e)));
    api
      .getSetting("chesscom_username")
      .then((value) => setChessComUsername(value ?? ""))
      .catch((error) => setMessage(String(error)));
    api
      .getSetting("engine_path")
      .then((v) => setEnginePath(v ?? "/opt/homebrew/bin/stockfish"))
      .catch(() => {});
    Promise.all([
      api.getSetting("engine_threads"),
      api.getSetting("engine_hash_mb"),
    ])
      .then(([threads, hashMb]) => {
        setThreads(threads ?? "4");
        setHashMb(hashMb ?? "256");
      })
      .catch((e) => setMessage(`引擎参数加载失败：${String(e)}`));
    Promise.all([getEngineDepth("preanalysis"), getEngineDepth("position")])
      .then(([preanalysis, position]) => {
        setPreanalysisDepth(String(preanalysis));
        setPositionDepth(String(position));
      })
      .catch((e) => setMessage(`分析深度加载失败：${String(e)}`));
    Promise.all(
      ["loss_inaccuracy", "loss_mistake", "loss_blunder"].map((k) =>
        api.getSetting(k),
      ),
    )
      .then(([a, b, c]) =>
        setThresholds({
          inaccuracy: Number(a ?? 0.12) * 100,
          mistake: Number(b ?? 0.25) * 100,
          blunder: Number(c ?? 0.4) * 100,
        }),
      )
      .catch(() => {});
  }, []);

  async function saveUsername() {
    const value = username.trim();
    setBusy(true);
    setLichessFeedback({
      action: "save",
      status: "pending",
      text: "正在保存 Lichess 用户名…",
    });
    try {
      await api.setSetting("lichess_username", value);
      setLichessFeedback({
        action: "save",
        status: "success",
        text: value ? "Lichess 用户名已保存" : "Lichess 账号已解除绑定",
      });
    } catch (error) {
      setLichessFeedback({
        action: "save",
        status: "error",
        text: `用户名保存失败：${error}`,
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveChessComUsername() {
    const value = chessComUsername.trim();
    if (value && !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
      setChessFeedback({
        action: "save",
        status: "error",
        text: "请填写 Chess.com 用户名，不要填写主页地址",
      });
      return;
    }
    setBusy(true);
    setChessFeedback({
      action: "save",
      status: "pending",
      text: "正在保存 Chess.com 用户名…",
    });
    try {
      await api.setSetting("chesscom_username", value);
      setChessFeedback({
        action: "save",
        status: "success",
        text: value ? "Chess.com 用户名已保存" : "Chess.com 账号已解除绑定",
      });
    } catch (error) {
      setChessFeedback({
        action: "save",
        status: "error",
        text: `用户名保存失败：${error}`,
      });
    } finally {
      setBusy(false);
    }
  }
  async function testChessComConnection() {
    setBusy(true);
    setChessFeedback({
      action: "test",
      status: "pending",
      text: "正在测试 Chess.com 连接…",
    });
    try {
      await api.chessComTest(chessComUsername.trim());
      setChessFeedback({
        action: "test",
        status: "success",
        text: "Chess.com 连接成功",
      });
    } catch (error) {
      setChessFeedback({
        action: "test",
        status: "error",
        text: `Chess.com 连接失败：${error}`,
      });
    } finally {
      setBusy(false);
    }
  }
  async function testConnection() {
    setBusy(true);
    setLichessFeedback({
      action: "test",
      status: "pending",
      text: "正在测试 Lichess 连接…",
    });
    try {
      await api.lichessTest(username.trim());
      setLichessFeedback({
        action: "test",
        status: "success",
        text: "Lichess 连接成功",
      });
    } catch (error) {
      setLichessFeedback({
        action: "test",
        status: "error",
        text: `Lichess 连接失败：${error}`,
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveToken() {
    setBusy(true);
    setLichessFeedback({
      action: "token",
      status: "pending",
      text: "正在保存 Token…",
    });
    try {
      await api.saveLichessToken(username.trim(), token);
      setToken("");
      setLichessFeedback({
        action: "token",
        status: "success",
        text: "Token 已保存",
      });
    } catch (error) {
      setLichessFeedback({
        action: "token",
        status: "error",
        text: `Token 保存失败：${error}`,
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveEngine() {
    try {
      if (
        ![preanalysisDepth, positionDepth].every(
          (value) =>
            value.trim() !== "" &&
            Number.isInteger(Number(value)) &&
            Number(value) >= 4 &&
            Number(value) <= 30,
        )
      )
        throw new Error("分析深度须为 4～30 的整数");
      if (
        threads.trim() === "" ||
        !Number.isInteger(Number(threads)) ||
        Number(threads) < 1 ||
        Number(threads) > 64
      )
        throw new Error("Threads 须为 1～64 的整数");
      if (
        hashMb.trim() === "" ||
        !Number.isInteger(Number(hashMb)) ||
        Number(hashMb) < 1 ||
        Number(hashMb) > 4096
      )
        throw new Error("Hash 须为 1～4096 MB 的整数");
      await api.engineValidate(enginePath.trim());
      await api.setSetting("engine_path", enginePath.trim());
      await api.setSetting(
        "engine_preanalysis_depth",
        String(normalizeEngineDepth(preanalysisDepth)),
      );
      await api.setSetting(
        "engine_position_depth",
        String(normalizeEngineDepth(positionDepth)),
      );
      await api.setSetting("engine_threads", String(Number(threads)));
      await api.setSetting("engine_hash_mb", String(Number(hashMb)));
      setMessage("引擎配置已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function saveThresholds() {
    try {
      if (!(
        thresholds.inaccuracy < thresholds.mistake &&
        thresholds.mistake < thresholds.blunder
      ))
        throw new Error("阈值必须递增");
      await Promise.all(
        Object.entries(thresholds).map(([k, v]) =>
          api.setSetting(`loss_${k}`, String(v / 100)),
        ),
      );
      setMessage("阈值已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }

  return (
    <>
      <Flex align="center" justify="between" mb="6">
        <Box>
          <Heading as="h1" size="7" mt="1">
            设置
          </Heading>
        </Box>
      </Flex>
      {message && (
        <Callout.Root size="1" mb="4">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      <UpdateSettings />
      <SoundSettings />
      <Card size="3" mb="4" className="max-w-155">
        <Flex direction="column" gap="4">
          <Heading size="4">Lichess 账户</Heading>
          <Text size="2" as="label">
            <Flex direction="column" gap="2">
              用户名
              <TextField.Root
                value={username}
                disabled={busy}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setLichessFeedback(null);
                }}
                placeholder="Lichess 用户名"
              />
            </Flex>
          </Text>
          <Text size="2" as="label">
            <Flex direction="column" gap="2">
              Personal Access Token（可选）
              <TextField.Root
                type="password"
                value={token}
                disabled={busy}
                onChange={(e) => {
                  setToken(e.target.value);
                  setLichessFeedback(null);
                }}
                placeholder="输入 Lichess Token"
              />
            </Flex>
          </Text>
          <AccountFeedback feedback={lichessFeedback} />
          <Flex gap="2" wrap="wrap">
            <Button disabled={busy} onClick={() => void saveUsername()}>
              {lichessFeedback?.status === "pending" &&
              lichessFeedback.action === "save"
                ? "保存中…"
                : "保存用户名"}
            </Button>
            <Button
              variant="soft"
              disabled={busy || !username.trim()}
              onClick={() => void testConnection()}
            >
              {lichessFeedback?.status === "pending" &&
              lichessFeedback.action === "test"
                ? "测试中…"
                : "测试连接"}
            </Button>
            <Button
              variant="soft"
              disabled={busy || !username.trim() || !token}
              onClick={() => void saveToken()}
            >
              {lichessFeedback?.status === "pending" &&
              lichessFeedback.action === "token"
                ? "保存中…"
                : "保存 Token"}
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Card size="3" mb="4" className="max-w-155">
        <Flex direction="column" gap="4">
          <Heading size="4">Chess.com 账户</Heading>
          <Text size="2" color="gray">
            填写用户名即可同步已结束的标准国际象棋对局，无需密码。点击同步时，会同步所有已配置的平台；清空并保存可解除绑定。本应用与
            Chess.com 无隶属关系。
          </Text>
          <Text as="label" size="2">
            <Flex direction="column" gap="2">
              用户名
              <TextField.Root
                aria-label="Chess.com 用户名"
                placeholder="Chess.com 用户名"
                value={chessComUsername}
                disabled={busy}
                onChange={(e) => {
                  setChessComUsername(e.target.value);
                  setChessFeedback(null);
                }}
              />
            </Flex>
          </Text>
          <AccountFeedback feedback={chessFeedback} />
          <Flex gap="2" wrap="wrap">
            <Button disabled={busy} onClick={() => void saveChessComUsername()}>
              {chessFeedback?.status === "pending" &&
              chessFeedback.action === "save"
                ? "保存中…"
                : "保存用户名"}
            </Button>
            <Button
              variant="soft"
              disabled={busy || !chessComUsername.trim()}
              onClick={() => void testChessComConnection()}
            >
              {chessFeedback?.status === "pending" &&
              chessFeedback.action === "test"
                ? "测试中…"
                : "测试连接"}
            </Button>
          </Flex>
        </Flex>
      </Card>
      <Card size="3" mb="4" className="max-w-155">
        <Flex direction="column" gap="4">
          <Heading size="4">Stockfish</Heading>
          <Text size="2" as="label">
            <Flex direction="column" gap="2">
              可执行文件路径
              <TextField.Root
                value={enginePath}
                onChange={(e) => setEnginePath(e.target.value)}
                placeholder="/opt/homebrew/bin/stockfish"
              />
            </Flex>
          </Text>
          <Text size="2" as="label">
            <Flex direction="column" gap="2">
              预分析深度
              <TextField.Root
                type="number"
                min="4"
                max="30"
                value={preanalysisDepth}
                onChange={(e) => setPreanalysisDepth(e.target.value)}
              />
            </Flex>
          </Text>
          <Text size="1" color="gray">
            用于整局预分析和批量失误扫描。
          </Text>
          <Text size="2" as="label">
            <Flex direction="column" gap="2">
              局面分析深度
              <TextField.Root
                type="number"
                min="4"
                max="30"
                step="1"
                value={positionDepth}
                onChange={(e) => setPositionDepth(e.target.value)}
              />
            </Flex>
          </Text>
          <Text size="1" color="gray">
            用于当前局面的 3 条候选招法及试走分支评价。
          </Text>
          <Flex gap="3" wrap="wrap">
            <Text size="2" as="label">
              <Flex direction="column" gap="2">
                Threads（线程数）
                <TextField.Root
                  type="number"
                  min="1"
                  max="64"
                  step="1"
                  value={threads}
                  onChange={(e) => setThreads(e.target.value)}
                />
              </Flex>
            </Text>
            <Text size="2" as="label">
              <Flex direction="column" gap="2">
                Hash（MB）
                <TextField.Root
                  type="number"
                  min="1"
                  max="4096"
                  step="1"
                  value={hashMb}
                  onChange={(e) => setHashMb(e.target.value)}
                />
              </Flex>
            </Text>
          </Flex>
          <Text size="1" color="gray">
            预分析和局面分析的每个引擎进程均使用此配置，两者可同时运行。保存后从下一次搜索起生效。
          </Text>
          <Flex>
            <Button onClick={() => void saveEngine()}>保存引擎配置</Button>
          </Flex>
        </Flex>
      </Card>
      <Card size="3" mb="4" className="max-w-155">
        <Flex direction="column" gap="4">
          <Heading size="4">失误分类阈值</Heading>
          {(["inaccuracy", "mistake", "blunder"] as const).map((k) => (
            <Text size="2" as="label" key={k}>
              <Flex direction="column" gap="2">
                {
                  {
                    inaccuracy: "轻微失误",
                    mistake: "失误",
                    blunder: "严重失误",
                  }[k]
                }
                （胜率损失 %）
                <TextField.Root
                  type="number"
                  min="1"
                  max="100"
                  value={thresholds[k]}
                  onChange={(e) =>
                    setThresholds((v) => ({
                      ...v,
                      [k]: Number(e.target.value),
                    }))
                  }
                />
              </Flex>
            </Text>
          ))}
          <Flex>
            <Button onClick={() => void saveThresholds()}>保存阈值</Button>
          </Flex>
        </Flex>
      </Card>
    </>
  );
}
