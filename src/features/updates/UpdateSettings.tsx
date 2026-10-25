import { useEffect } from "react";
import { Button, Card, Flex, Heading, Progress, Text } from "@radix-ui/themes";
import { updateBusy, useUpdater } from "./update-store";

export default function UpdateSettings() {
  const update = useUpdater();
  const loadVersion = update.loadVersion;
  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);
  const busy = updateBusy(update.phase);
  const percent = update.total
    ? Math.min(100, (update.downloaded / update.total) * 100)
    : undefined;
  return (
    <Card size="3" mb="4" className="max-w-155" aria-label="应用更新">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3">
          <Heading size="4">应用更新</Heading>
          <Text size="2" color="gray">
            当前版本 {update.currentVersion || "—"}
          </Text>
        </Flex>
        {update.message && (
          <Text
            size="2"
            role="status"
            aria-live="polite"
            color={update.phase === "error" ? "red" : undefined}
          >
            {update.message}
          </Text>
        )}
        {update.phase === "downloading" && (
          <Flex direction="column" gap="2">
            <Progress value={percent} aria-label="更新下载进度" />
            <Text size="1" color="gray">
              {percent === undefined
                ? `已下载 ${(update.downloaded / 1024 / 1024).toFixed(1)} MB`
                : `${percent.toFixed(0)}%`}
            </Text>
          </Flex>
        )}
        {update.notes && (
          <Text size="2" className="max-h-40 overflow-auto whitespace-pre-wrap">
            {update.notes}
          </Text>
        )}
        <Flex gap="2" wrap="wrap">
          {update.phase === "installed" ? (
            <Button onClick={() => void update.restart()}>重启应用</Button>
          ) : (
            <>
              <Button
                variant="soft"
                disabled={busy}
                onClick={() => void update.checkForUpdate()}
              >
                {update.phase === "checking" ? "检查中…" : "检查更新"}
              </Button>
              {update.phase === "available" && (
                <Button onClick={() => void update.installUpdate()}>
                  下载并安装 {update.version}
                </Button>
              )}
            </>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
