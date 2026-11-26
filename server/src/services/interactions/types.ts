export type InteractionEvent =
  | { type: 'transcript'; text: string }
  | { type: 'transcription_error' | 'processing_error'; code: string; message: string };

export type InteractionAudio = {
  wav: Uint8Array;
  path: string;
};
