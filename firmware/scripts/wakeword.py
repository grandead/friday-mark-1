"""Offline template matching for mono PCM16 WAVs. Requires Python 3 and NumPy."""
import argparse
import wave
from pathlib import Path

import numpy as np

HOP = 0.01
WINDOW = 0.025


def features(path):
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or rate < 16000:
            raise ValueError(f"{path}: expected mono PCM16, at least 16 kHz")
        audio = np.frombuffer(wav.readframes(wav.getnframes()), "<i2").astype(float)

    width, hop = round(WINDOW * rate), round(HOP * rate)
    if len(audio) < width:
        raise ValueError(f"{path}: shorter than one analysis frame")
    frames = np.lib.stride_tricks.sliding_window_view(audio, width)[::hop]
    power = abs(np.fft.rfft((frames - frames.mean(axis=1, keepdims=True))
                            * np.hanning(width), axis=1)) ** 2
    frequencies = np.fft.rfftfreq(width, 1 / rate)
    # Identical acoustic bands for the board's 20 kHz and ordinary 16 kHz WAVs.
    edges = 700 * np.expm1(np.linspace(np.log1p(120 / 700), np.log1p(7600 / 700), 34))
    rising = (frequencies[:, None] - edges[:-2]) / np.diff(edges)[:-1]
    falling = (edges[2:] - frequencies[:, None]) / np.diff(edges)[1:]
    bands = power @ np.maximum(0, np.minimum(rising, falling))
    energy = bands.sum(axis=1)
    log_bands = np.log(np.maximum(bands, 1))
    basis = np.cos(np.pi / 32 * (np.arange(32)[:, None] + 0.5) * np.arange(1, 14))
    cepstra = log_bands @ basis
    cepstra /= np.maximum(np.linalg.norm(cepstra, axis=1, keepdims=True), 1e-9)
    return cepstra, energy


def template(path):
    frames, energy = features(path)
    if len(energy) < 10 or not energy.any():
        raise ValueError(f"{path}: reference too short or silent")
    smooth = np.convolve(energy, np.ones(7) / 7, mode="same")
    peak = int(smooth.argmax())
    # Enrol isolated words only. Restrict the search to the peak's neighbourhood
    # so that a distant handling noise does not extend the template to a full clip.
    start, stop = max(0, peak - 24), min(len(frames), peak + 55)
    gate = max(np.percentile(smooth, 20) * 3, smooth[peak] * 0.012)
    active = np.flatnonzero(smooth[start:stop] >= gate)
    if not len(active):
        raise ValueError(f"{path}: no distinct speech peak")
    return frames[max(0, start + active[0] - 5):min(len(frames), start + active[-1] + 7)]


def dtw(reference, query):
    """Subsequence DTW cost for a match ending at each query frame."""
    distance = np.clip(1 - reference @ query.T, 0, 2)
    n = len(query)
    previous = np.zeros(n + 1)  # Start at any query offset.
    older = np.full(n + 1, np.inf)
    for index, cost in enumerate(distance):
        current = np.full(n + 1, np.inf)
        current[1:] = previous[:-1] + cost
        if index:
            current[1:] = np.minimum(current[1:], older[:-1] + distance[index - 1] + cost)
        current[2:] = np.minimum(current[2:], previous[:-2] + (cost[:-1] + cost[1:]) / 2)
        older, previous = previous, current
    return previous[1:] / len(reference)


def scores(references, path):
    query, _ = features(path)
    costs = np.array([dtw(ref, query) for ref in references])
    # Require agreement of the two closest templates at the same endpoint.
    count = min(2, len(costs))
    return np.partition(costs, count - 1, axis=0)[:count].mean(axis=0)


def triggers(cost, threshold):
    times = []
    last = -float("inf")
    for frame, value in enumerate(cost):
        time = WINDOW + frame * HOP
        if value <= threshold and time - last >= 1.0:
            times.append(time)
            last = time
    return times


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, action="append", default=[],
                        help="isolated wake word WAV, repeat for each example")
    parser.add_argument("--trimmed-reference", type=Path, action="append", default=[],
                        help="use the full duration of an already trimmed reference WAV")
    parser.add_argument("--threshold", type=float, required=True, help="maximum DTW distance")
    parser.add_argument("wavs", nargs="+", type=Path)
    args = parser.parse_args()
    if not (args.reference or args.trimmed_reference):
        parser.error("supply at least one --reference or --trimmed-reference")
    references = [template(path) for path in args.reference]
    for path in args.trimmed_reference:
        frames, energy = features(path)
        if len(frames) < 10 or not energy.any():
            parser.error(f"{path}: reference too short or silent")
        references.append(frames)
    for path in args.wavs:
        cost = scores(references, path)
        hits = ", ".join(f"{t:.2f}s" for t in triggers(cost, args.threshold))
        print(f"{path.name}  best={min(cost):.4f}  triggers={hits or 'none'}")


if __name__ == "__main__":
    main()
