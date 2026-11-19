import { IconButton } from "@radix-ui/themes";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyFenToClipboard } from "../clipboard";

interface CopiedState {
  fen: string;
  seq: number;
}

export interface CopyFenButtonProps {
  fen: string | undefined;
  onError?: (message: string) => void;
}

export function CopyFenButton({ fen, onError }: CopyFenButtonProps) {
  const [copied, setCopied] = useState<CopiedState | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
    };
  }, [fen]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const hasFen = Boolean(fen && fen.trim().length > 0);
  const active = Boolean(hasFen && copied?.fen === fen);

  async function handleCopy() {
    if (!fen || fen.trim().length === 0) return;
    const seq = ++requestSeqRef.current;
    const result = await copyFenToClipboard(fen);
    if (requestSeqRef.current !== seq) return;
    if (result.ok) {
      setCopied((prev) => ({
        fen: result.fen,
        seq: (prev?.seq ?? 0) + 1,
      }));
      return;
    }
    onError?.(result.message);
  }

  return (
    <IconButton
      type="button"
      size="1"
      variant="ghost"
      className="[&_svg]:size-4"
      disabled={!hasFen}
      onClick={() => void handleCopy()}
      aria-label="复制当前局面 FEN"
      title={active ? "已复制 FEN" : "复制 FEN"}
    >
      {active ? <Check /> : <Copy />}
    </IconButton>
  );
}
