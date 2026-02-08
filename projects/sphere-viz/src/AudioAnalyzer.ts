import { getAudioData, useAudioData, visualizeAudio } from "@remotion/media-utils";

export interface FrequencyData {
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  overall: number;
}

/**
 * Extract frequency data from audio visualization
 * Splits FFT data into bass, low-mid, mid, high-mid, treble ranges
 */
export function extractFrequencyBands(
  fftData: number[],
  numberOfSamples: number = 256
): FrequencyData {
  const length = fftData.length;
  
  // Define frequency band ranges (as percentages of FFT bins)
  const bassEnd = Math.floor(length * 0.08);      // ~0-100Hz
  const lowMidEnd = Math.floor(length * 0.15);    // ~100-300Hz
  const midEnd = Math.floor(length * 0.35);       // ~300-2kHz
  const highMidEnd = Math.floor(length * 0.6);    // ~2k-8kHz
  // Rest is treble: ~8k-20kHz
  
  const average = (arr: number[], start: number, end: number): number => {
    if (end <= start) return 0;
    const slice = arr.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  
  return {
    bass: average(fftData, 0, bassEnd),
    lowMid: average(fftData, bassEnd, lowMidEnd),
    mid: average(fftData, lowMidEnd, midEnd),
    highMid: average(fftData, midEnd, highMidEnd),
    treble: average(fftData, highMidEnd, length),
    overall: average(fftData, 0, length),
  };
}

/**
 * Get interpolated audio data for a specific frame
 */
export function getAudioDataForFrame(
  audioData: ReturnType<typeof useAudioData>,
  frame: number,
  fps: number,
  numberOfSamples: number = 256
): number[] {
  if (!audioData) {
    return new Array(numberOfSamples).fill(0);
  }
  
  return visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples,
  });
}

/**
 * Apply smoothing between frames for cleaner visualization
 */
export function smoothFrequencyData(
  current: FrequencyData,
  previous: FrequencyData | null,
  smoothingFactor: number = 0.3
): FrequencyData {
  if (!previous) return current;
  
  const smooth = (curr: number, prev: number) =>
    prev * smoothingFactor + curr * (1 - smoothingFactor);
    
  return {
    bass: smooth(current.bass, previous.bass),
    lowMid: smooth(current.lowMid, previous.lowMid),
    mid: smooth(current.mid, previous.mid),
    highMid: smooth(current.highMid, previous.highMid),
    treble: smooth(current.treble, previous.treble),
    overall: smooth(current.overall, previous.overall),
  };
}

export { getAudioData, useAudioData, visualizeAudio };
