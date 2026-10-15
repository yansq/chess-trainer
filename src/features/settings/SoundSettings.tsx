import { playSound, type MoveSoundType } from "../../shared/audio/move-sound";
import { useSoundSettings } from "../../shared/audio/settings";
import type { CSSProperties } from "react";

export default function SoundSettings() {
  const { enabled, volume, setEnabled, setVolume } = useSoundSettings();
  return (
    <div className="panel settings-panel rounded-xl border border-panel-edge bg-panel mb-4 max-w-[620px] px-[22px] pb-[22px] [&>.section-title]:mx-[-22px] [&>.section-title]:mb-5 [&_p]:text-[13px] [&_p]:leading-[1.6] [&_p]:text-[#93a69d] [&_label]:mt-[18px] [&_label]:grid [&_label]:gap-2 [&_label]:text-[13px]">
      <div className="section-title border-b border-panel-edge px-[18px] py-4 text-[14px] font-bold [&_span]:ml-[7px] [&_span]:text-[12px] [&_span]:font-normal [&_span]:text-[#7d928d]">
        声音
      </div>
      <div className="sound-setting-row flex items-center justify-between gap-3 text-[13px]">
        <span id="sound-enabled-label">走子音效</span>
        <button
          className="sound-switch h-6 w-[42px] shrink-0 rounded-[20px] border-none border-current bg-[#738080] p-[3px] outline-none aria-checked:bg-accent [&>span]:mr-auto [&>span]:size-[18px] [&>span]:rounded-full [&>span]:bg-accent-dark aria-checked:[&>span]:mr-0 aria-checked:[&>span]:ml-auto focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-4"
          role="switch"
          aria-labelledby="sound-enabled-label"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          <span />
        </button>
      </div>
      <label htmlFor="sound-volume">
        <span className="sound-setting-row flex items-center justify-between gap-3 text-[13px]">
          音量 <output>{volume}%</output>
        </span>
        <input
          id="sound-volume"
          className="sound-volume-slider my-2 h-1.5 w-full cursor-pointer appearance-none rounded-md border-none border-current p-0 shadow-none bg-transparent bg-[linear-gradient(to_right,var(--color-accent)_var(--sound-volume),var(--color-control-edge)_var(--sound-volume))] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-accent-ink [&::-webkit-slider-thumb]:bg-accent-dark disabled:cursor-default disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-4 focus:shadow-none"
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
      <div className="settings-actions mt-[18px] flex gap-2.5">
        {(
          [
            ["move", "普通走子"],
            ["capture", "吃子"],
            ["check", "将军"],
          ] satisfies [MoveSoundType, string][]
        ).map(([type, label]) => (
          <button
            key={type}
            className="secondary border-control-edge bg-secondary text-secondary-ink"
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
