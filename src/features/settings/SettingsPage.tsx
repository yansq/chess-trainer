import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import SoundSettings from "./SoundSettings";

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
      <div className="mb-7 flex items-center justify-between gap-5 [&_p]:m-0 [&_p]:text-sm [&_p]:text-description">
        <div>
          <div className="text-eyebrow font-emphasis tracking-eyebrow text-eyebrow-ink">
            PREFERENCES
          </div>
          <h1>设置</h1>
        </div>
      </div>
      {message && (
        <div className="mb-4.5 rounded-lg border border-notice-edge bg-notice px-3.75 py-3 text-body-sm text-notice-ink">
          {message}
        </div>
      )}
      <SoundSettings />
      <div className="rounded-xl border border-panel-edge bg-panel mb-4 max-w-155 px-5.5 pb-5.5 [&>.section-title]:-mx-5.5 [&>.section-title]:mb-5 [&_p]:text-body-sm [&_p]:leading-copy [&_p]:text-settings-description [&_label]:mt-4.5 [&_label]:grid [&_label]:gap-2 [&_label]:text-body-sm">
        <div className="section-title border-b border-panel-edge px-4.5 py-4 text-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          Lichess 账户
        </div>
        <label>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Lichess 用户名"
          />
        </label>
        <label>
          Personal Access Token（可选）
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="输入 Lichess Token"
          />
        </label>
        <div className="mt-4.5 flex gap-2.5">
          <button
            disabled={busy || !username.trim()}
            onClick={() => void saveUsername()}
          >
            保存用户名
          </button>
          <button
            className="border-control-edge bg-secondary text-secondary-ink"
            disabled={busy || !username.trim()}
            onClick={() => void testConnection()}
          >
            测试连接
          </button>
          <button
            className="border-control-edge bg-secondary text-secondary-ink"
            disabled={busy || !username.trim() || !token}
            onClick={() => void saveToken()}
          >
            保存 Token
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-panel-edge bg-panel mb-4 max-w-155 px-5.5 pb-5.5 [&>.section-title]:-mx-5.5 [&>.section-title]:mb-5 [&_p]:text-body-sm [&_p]:leading-copy [&_p]:text-settings-description [&_label]:mt-4.5 [&_label]:grid [&_label]:gap-2 [&_label]:text-body-sm">
        <div className="section-title border-b border-panel-edge px-4.5 py-4 text-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          Stockfish
        </div>
        <label>
          可执行文件路径
          <input
            value={enginePath}
            onChange={(e) => setEnginePath(e.target.value)}
            placeholder="/opt/homebrew/bin/stockfish"
          />
        </label>
        <label>
          分析深度
          <input
            type="number"
            min="4"
            max="30"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
        </label>
        <div className="mt-4.5 flex gap-2.5">
          <button onClick={() => void saveEngine()}>保存引擎配置</button>
        </div>
      </div>
      <div className="rounded-xl border border-panel-edge bg-panel mb-4 max-w-155 px-5.5 pb-5.5 [&>.section-title]:-mx-5.5 [&>.section-title]:mb-5 [&_p]:text-body-sm [&_p]:leading-copy [&_p]:text-settings-description [&_label]:mt-4.5 [&_label]:grid [&_label]:gap-2 [&_label]:text-body-sm">
        <div className="section-title border-b border-panel-edge px-4.5 py-4 text-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
          失误分类阈值
        </div>
        {(["inaccuracy", "mistake", "blunder"] as const).map((k) => (
          <label key={k}>
            {
              { inaccuracy: "轻微失误", mistake: "失误", blunder: "严重失误" }[
                k
              ]
            }
            （胜率损失 %）
            <input
              type="number"
              min="1"
              max="100"
              value={thresholds[k]}
              onChange={(e) =>
                setThresholds((v) => ({ ...v, [k]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
        <div className="mt-4.5 flex gap-2.5">
          <button onClick={() => void saveThresholds()}>保存阈值</button>
        </div>
      </div>
    </>
  );
}
