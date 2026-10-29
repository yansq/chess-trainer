import { Box, Button, Card, Flex, TextArea } from "@radix-ui/themes";
import { useState } from "react";

type Props = {
  onSave: (content: string) => Promise<void>;
  heading: string;
  content: string;
  onSaved: (content: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
};
export default function NotePanel({
  onSave,
  heading,
  content,
  onSaved,
  onError,
  disabled = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving || disabled) return;
    setSaving(true);
    try {
      await onSave(draft);
      onSaved(draft);
      setEditing(false);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }
  function startEditing() {
    if (disabled) return;
    setDraft(content);
    setEditing(true);
  }
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
      <Box className="section-title shrink-0 border-b border-panel-edge px-3 py-1.5 text-body-sm font-bold">
        {heading}
      </Box>
      {editing ? (
        <TextArea
          disabled={saving || disabled}
          autoFocus
          className="m-1.5 block min-h-9 w-note-field flex-1 resize-none leading-5"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="记录判断、候选招法、犯错原因…"
        />
      ) : (
        <Box
          className="min-h-0 flex-1 overflow-auto overscroll-contain cursor-text whitespace-pre-wrap wrap-anywhere p-2 text-body-sm leading-normal"
          onClick={startEditing}
        >
          {content || <span className="text-muted">点击添加笔记…</span>}
        </Box>
      )}
      <Flex
        wrap="wrap"
        justify="end"
        gap="2"
        px="3"
        className="shrink-0 border-t border-panel-edge py-1.5"
      >
        <Button
          size="1"
          variant="soft"
          disabled={saving || disabled}
          onClick={editing ? () => void save() : startEditing}
        >
          {saving ? "保存中…" : editing ? "保存笔记" : "编辑笔记"}
        </Button>
      </Flex>
    </Card>
  );
}
