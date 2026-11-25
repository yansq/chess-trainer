import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Table,
  Text,
} from "@radix-ui/themes";
import { useRef, type ChangeEvent } from "react";
import type { BackupCounts } from "../../shared/types";
import { useGameSync } from "../games/sync-store";
import {
  hasBackupUserData,
  isBackupBusy,
  useBackup,
  type BackupFeedback,
} from "./backup-store";

export interface BackupSettingsProps {
  onRestored: () => Promise<void>;
}

const COUNT_ROWS: readonly { key: keyof BackupCounts; label: string }[] = [
  { key: "games", label: "对局" },
  { key: "moves", label: "招法" },
  { key: "annotations", label: "对局笔记" },
  { key: "reviewVariations", label: "复盘分支" },
  { key: "puzzles", label: "错题" },
  { key: "reviewLogs", label: "训练记录" },
  { key: "repertoires", label: "开局库" },
  { key: "settings", label: "配置项" },
];

function FeedbackCallout({ feedback }: { feedback: BackupFeedback | null }) {
  if (!feedback) return null;
  const color =
    feedback.status === "error"
      ? "red"
      : feedback.status === "success"
        ? "green"
        : "gray";
  return (
    <Callout.Root
      size="1"
      color={color}
      role={feedback.status === "error" ? "alert" : "status"}
      aria-live={feedback.status === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Callout.Text className="break-all">{feedback.text}</Callout.Text>
    </Callout.Root>
  );
}

export default function BackupSettings({ onRestored }: BackupSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = useBackup((s) => s.state);
  const exportCurrent = useBackup((s) => s.exportCurrent);
  const stageFile = useBackup((s) => s.stageFile);
  const cancelImport = useBackup((s) => s.cancelImport);
  const confirmImport = useBackup((s) => s.confirmImport);
  const syncRunning = useGameSync((s) => s.running);
  const syncPausing = useGameSync((s) => s.pausing);
  const pauseSync = useGameSync((s) => s.pause);

  const busy = isBackupBusy(state);
  const inlineFeedback =
    state.kind === "idle" || state.kind === "exporting" ? state.feedback : null;
  const dialogOpen = state.kind === "confirming" || state.kind === "importing";
  const inspection =
    state.kind === "confirming" || state.kind === "importing"
      ? state.inspection
      : null;

  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void stageFile(file);
    }
  }

  return (
    <Card size="3" mb="4" className="max-w-155">
      <Flex direction="column" gap="4">
        <Heading size="4">数据备份与恢复</Heading>
        <Text size="2" color="gray">
          将对局记录、复盘笔记与分支、错题与训练进度、开局库、账号用户名、分析参数及界面/音效偏好导出为单个
          JSON 快照文件。
        </Text>
        <Text size="1" color="gray">
          出于安全与跨设备兼容考虑，系统钥匙串中的 Lichess Token、本机
          Stockfish 可执行文件路径及本地引擎分析缓存不会包含在备份中。
        </Text>

        {syncRunning && (
          <Callout.Root size="1" color="amber" role="status">
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <Callout.Text>
                正在后台同步对局，请先暂停或等待同步完成后再导出或导入备份。
              </Callout.Text>
              <Button
                size="1"
                variant="soft"
                disabled={syncPausing}
                onClick={pauseSync}
              >
                {syncPausing ? "正在暂停…" : "暂停同步"}
              </Button>
            </Flex>
          </Callout.Root>
        )}

        <FeedbackCallout feedback={inlineFeedback} />

        <Flex gap="2" wrap="wrap">
          <Button
            disabled={busy || syncRunning}
            onClick={() => void exportCurrent()}
          >
            {state.kind === "exporting" ? "导出中…" : "导出备份"}
          </Button>
          <Button
            variant="soft"
            disabled={busy || syncRunning}
            onClick={() => fileInputRef.current?.click()}
          >
            {state.kind === "inspecting" ? "检查备份中…" : "导入备份"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="选择备份文件"
            className="hidden"
            onChange={onFileSelected}
          />
        </Flex>
      </Flex>

      <AlertDialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) cancelImport();
        }}
      >
        {inspection &&
          (state.kind === "confirming" || state.kind === "importing") && (
            <AlertDialog.Content maxWidth="560px">
              <AlertDialog.Title>确认恢复备份</AlertDialog.Title>
              <AlertDialog.Description size="2" mb="3">
                文件 {state.fileName} · 导出于 {inspection.exportedAt} · 应用版本
                v{inspection.appVersion}（Schema v{inspection.dbSchemaVersion}）
              </AlertDialog.Description>

              <Box maxHeight="52vh" className="overflow-y-auto pr-1">
                <Flex direction="column" gap="3">
                  <Table.Root size="1" variant="surface">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>数据类型</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell align="right">
                          备份快照
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell align="right">
                          当前本地
                        </Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {COUNT_ROWS.map(({ key, label }) => (
                        <Table.Row key={key}>
                          <Table.RowHeaderCell>{label}</Table.RowHeaderCell>
                          <Table.Cell align="right">
                            {inspection.backupCounts[key]}
                          </Table.Cell>
                          <Table.Cell align="right">
                            {inspection.currentCounts[key]}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>

                  {inspection.warnings.map((warning) => (
                    <Callout.Root
                      key={warning.code}
                      size="1"
                      color={
                        warning.code === "overwritesExistingData"
                          ? "red"
                          : "amber"
                      }
                    >
                      <Callout.Text>{warning.message}</Callout.Text>
                    </Callout.Root>
                  ))}

                  {state.kind === "confirming" && (
                    <FeedbackCallout feedback={state.safetyFeedback} />
                  )}
                </Flex>
              </Box>

              <Flex gap="2" mt="4" justify="end" wrap="wrap">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray" disabled={busy}>
                    取消
                  </Button>
                </AlertDialog.Cancel>
                {hasBackupUserData(inspection.currentCounts) && (
                  <Button
                    variant="soft"
                    disabled={busy || syncRunning}
                    onClick={() => void exportCurrent()}
                  >
                    {state.kind === "confirming" && state.exportingSafetyCopy
                      ? "导出中…"
                      : "先导出当前数据"}
                  </Button>
                )}
                <Button
                  color="red"
                  disabled={busy || syncRunning}
                  onClick={() => void confirmImport(onRestored)}
                >
                  {state.kind === "importing"
                    ? "正在恢复…"
                    : "确认覆盖并恢复"}
                </Button>
              </Flex>
            </AlertDialog.Content>
          )}
      </AlertDialog.Root>
    </Card>
  );
}
