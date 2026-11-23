import { humidifierCommand } from '../smartHome/humidifier.js';

type Transcribe = (path: string) => Promise<string>;

// Preserve the existing exact command recognizer; use Whisper for open-ended speech.
// Do not accept fuzzy matches here: the transcript can trigger a physical action.
export function createHybridTranscriber(commands: Transcribe, speech: Transcribe): Transcribe {
  return async path => {
    const candidate = await commands(path);
    return humidifierCommand(candidate) ? candidate : speech(path);
  };
}
