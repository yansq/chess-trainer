import { playSound, type MoveSoundType } from "../../shared/audio/move-sound";
import { useSoundSettings } from "../../shared/audio/settings";

export default function SoundSettings() {
  const { enabled, volume, setEnabled, setVolume } = useSoundSettings();
  return (
    <div className="panel settings-panel">
      <div className="section-title">声音</div>
      <div className="sound-setting-row">
        <span id="sound-enabled-label">走子音效</span>
        <button
          className="sound-switch"
          role="switch"
          aria-labelledby="sound-enabled-label"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          <span />
        </button>
      </div>
      <label htmlFor="sound-volume">
        <span className="sound-setting-row">
          音量 <output>{volume}%</output>
        </span>
        <input
          id="sound-volume"
          className="sound-volume-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          disabled={!enabled}
          style={{
            background: `linear-gradient(to right, #78a98b ${volume}%, #344648 ${volume}%)`,
          }}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </label>
      <div className="settings-actions">
        {(
          [
            ["move", "普通走子"],
            ["capture", "吃子"],
            ["check", "将军"],
          ] satisfies [MoveSoundType, string][]
        ).map(([type, label]) => (
          <button
            key={type}
            className="secondary"
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
