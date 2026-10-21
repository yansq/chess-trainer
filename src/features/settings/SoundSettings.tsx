import { playSound, type MoveSoundType } from "../../shared/audio/move-sound";
import { useSoundSettings } from "../../shared/audio/settings";
import type { CSSProperties } from "react";

export default function SoundSettings() {
  const { enabled, volume, setEnabled, setVolume } = useSoundSettings();
  return (
    <div className="rounded-xl border border-panel-edge bg-panel mb-4 max-w-155 px-5.5 pb-5.5 [&>.section-title]:-mx-5.5 [&>.section-title]:mb-5 [&_p]:text-body-sm [&_p]:leading-copy [&_p]:text-settings-description [&_label]:mt-4.5 [&_label]:grid [&_label]:gap-2 [&_label]:text-body-sm">
      <div className="section-title border-b border-panel-edge px-4.5 py-4 text-sm font-bold [&_span]:ml-1.75 [&_span]:text-xs [&_span]:font-normal [&_span]:text-caption-ink">
        声音
      </div>
      <div className="flex items-center justify-between gap-3 text-body-sm">
        <span id="sound-enabled-label">走子音效</span>
        <button
          className="h-6 w-10.5 shrink-0 rounded-full border-none border-current bg-switch-off p-0.75 outline-none aria-checked:bg-accent [&>span]:mr-auto [&>span]:size-4.5 [&>span]:rounded-full [&>span]:bg-accent-dark aria-checked:[&>span]:mr-0 aria-checked:[&>span]:ml-auto focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-4"
          role="switch"
          aria-labelledby="sound-enabled-label"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          <span />
        </button>
      </div>
      <label htmlFor="sound-volume">
        <span className="flex items-center justify-between gap-3 text-body-sm">
          音量 <output>{volume}%</output>
        </span>
        <input
          id="sound-volume"
          className="my-2 h-1.5 w-full cursor-pointer appearance-none rounded-md border-none border-current p-0 shadow-none bg-transparent bg-volume [&::-webkit-slider-thumb]:size-4.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-3 [&::-webkit-slider-thumb]:border-accent-ink [&::-webkit-slider-thumb]:bg-accent-dark disabled:cursor-default disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-4 focus:shadow-none"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          disabled={!enabled}
          style={{ "--sound-volume": `${volume}%` } as CSSProperties}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </label>
      <div className="mt-4.5 flex gap-2.5">
        {(
          [
            ["move", "普通走子"],
            ["capture", "吃子"],
            ["check", "将军"],
          ] satisfies [MoveSoundType, string][]
        ).map(([type, label]) => (
          <button
            key={type}
            className="border-control-edge bg-secondary text-secondary-ink"
            disabled={!enabled || volume === 0}
            aria-label={`试听${label}音效`}
            onClick={() => void playSound(type)}
          >
            试听{label}
          </button>
        ))}
      </div>
    </div>
  );
}
