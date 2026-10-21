import { Box, Button, Card, Flex, TextArea } from "@radix-ui/themes";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../../shared/api";

type Props = {
  gameId: string;
  moveId: string | null;
  heading: string;
  content: string;
  temporary?: boolean;
  onSaved: (content: string) => void;
  onError: (message: string) => void;
};
export default function NotePanel({
  gameId,
  moveId,
  heading,
  content,
  temporary = false,
  onSaved,
  onError,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  async function save() {
    try {
      if (!temporary) await api.saveAnnotation(gameId, moveId, draft);
      onSaved(draft);
      setEditing(false);
    } catch (e) {
      onError(String(e));
    }
  }
  function startEditing() {
    setDraft(content);
    setEditing(true);
  }
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
      <Box className="section-title shrink-0 border-b border-panel-edge px-3 py-1.5 text-body-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
        {heading}
        <span>Markdown</span>
      </Box>
      {editing ? (
        <>
          <TextArea
            className="m-1.5 block min-h-9 w-note-field flex-1 resize-none leading-5"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="记录判断、候选招法、犯错原因…"
          />
        </>
      ) : (
        <Box
          className="min-h-0 flex-1 overflow-auto overscroll-contain cursor-text break-words [&_pre]:overflow-auto [&_img]:max-w-full p-2 text-body-sm leading-normal [&_p]:mb-2 [&_p]:mt-0"
          onClick={startEditing}
        >
          {content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <span className="text-muted">点击添加笔记…</span>
          )}
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
          onClick={editing ? () => void save() : startEditing}
        >
          {editing ? (temporary ? "暂存笔记" : "保存笔记") : "编辑笔记"}
        </Button>
      </Flex>
    </Card>
  );
}
