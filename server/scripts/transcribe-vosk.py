"""Offline full-text Russian ASR for mono PCM16 WAV."""
import json
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
with wave.open(sys.argv[2], 'rb') as wav:
    if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
        raise ValueError("expected mono PCM16")
    recognizer = KaldiRecognizer(Model(sys.argv[1]), wav.getframerate())
    segments = []
    while chunk := wav.readframes(4000):
        if recognizer.AcceptWaveform(chunk):
            segments.append(json.loads(recognizer.Result())['text'])
    segments.append(json.loads(recognizer.FinalResult())['text'])
    print(' '.join(filter(None, segments)))
