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

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [enginePath, setEnginePath] = useState("");
  const [depth, setDepth] = useState(14);
  const [thresholds, setThresholds] = useState({
    inaccuracy: 12,
    mistake: 25,
    blunder: 40,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getSetting("lichess_username")
      .then((v) => setUsername(v ?? ""))
      .catch((e) => setMessage(String(e)));
    api
      .getSetting("engine_path")
      .then((v) => setEnginePath(v ?? "/opt/homebrew/bin/stockfish"))
      .catch(() => {});
    api
      .getSetting("engine_depth")
      .then((v) => setDepth(Number(v ?? 14)))
      .catch(() => {});
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
    setBusy(true);
    try {
      await api.setSetting("lichess_username", username.trim());
      setMessage("用户名已保存");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function testConnection() {
    setBusy(true);
    try {
      await api.lichessTest(username.trim());
      setMessage("Lichess 连接成功");
    } catch (e) {
      setMessage(`连接失败：${e}`);
    } finally {
      setBusy(false);
    }
  }
  async function saveToken() {
    try {
      await api.saveLichessToken(username.trim(), token);
      setToken("");
      setMessage("Token 已保存");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function saveEngine() {
    try {
      await api.engineValidate(enginePath.trim());
      await api.setSetting("engine_path", enginePath.trim());
      await api.setSetting(
        "engine_depth",
        String(Math.max(4, Math.min(30, depth))),
      );
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
          <Text size="1" color="gray" weight="bold">
            PREFERENCES
          </Text>
          <Heading as="h1" size="8" mt="1">
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
                onChange={(e) => setUsername(e.target.value)}
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
                onChange={(e) => setToken(e.target.value)}
                placeholder="输入 Lichess Token"
              />
            </Flex>
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button
              disabled={busy || !username.trim()}
              onClick={() => void saveUsername()}
            >
              保存用户名
            </Button>
            <Button
              variant="soft"
              disabled={busy || !username.trim()}
              onClick={() => void testConnection()}
            >
              测试连接
            </Button>
            <Button
              variant="soft"
              disabled={busy || !username.trim() || !token}
              onClick={() => void saveToken()}
            >
              保存 Token
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
              分析深度
              <TextField.Root
                type="number"
                min="4"
                max="30"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              />
            </Flex>
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
