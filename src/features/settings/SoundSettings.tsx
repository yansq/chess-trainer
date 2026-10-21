import {
  Button,
  Card,
  Flex,
  Heading,
  Slider,
  Switch,
  Text,
} from "@radix-ui/themes";
import { playSound, type MoveSoundType } from "../../shared/audio/move-sound";
import { useSoundSettings } from "../../shared/audio/settings";

export default function SoundSettings() {
  const { enabled, volume, setEnabled, setVolume } = useSoundSettings();
  return (
    <Card size="3" mb="4" className="max-w-155">
      <Flex direction="column" gap="5">
        <Heading size="4">声音</Heading>
        <Flex align="center" justify="between" gap="3">
          <Text size="2" id="sound-enabled-label">
            走子音效
          </Text>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-labelledby="sound-enabled-label"
          />
        </Flex>
        <Flex direction="column" gap="3">
          <Flex align="center" justify="between">
            <Text size="2" id="sound-volume-label">
              音量
            </Text>
            <Text size="2" color="gray" asChild>
              <output>{volume}%</output>
            </Text>
          </Flex>
          <Slider
            aria-labelledby="sound-volume-label"
            min={0}
            max={100}
            step={1}
            value={[volume]}
            disabled={!enabled}
            onValueChange={([next]) => setVolume(next)}
          />
        </Flex>
        <Flex gap="2" wrap="wrap">
          {(
            [
              ["move", "普通走子"],
              ["capture", "吃子"],
              ["check", "将军"],
            ] satisfies [MoveSoundType, string][]
          ).map(([type, label]) => (
            <Button
              key={type}
              size="2"
              variant="soft"
              disabled={!enabled || volume === 0}
              aria-label={`试听${label}音效`}
              onClick={() => void playSound(type)}
            >
              试听{label}
            </Button>
          ))}
        </Flex>
      </Flex>
    </Card>
  );
}
