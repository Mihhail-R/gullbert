import type { Sound } from "../simulation/model.js";

const tones: Record<Sound, {
  frequency: number;
  endingFrequency: number;
  waveform: OscillatorType;
}> = {
  squawk: { frequency: 760, endingFrequency: 310, waveform: "sawtooth" },
  plop: { frequency: 130, endingFrequency: 45, waveform: "sine" },
  munch: { frequency: 240, endingFrequency: 45, waveform: "sine" },
  pop: { frequency: 980, endingFrequency: 45, waveform: "sine" },
  splash: { frequency: 410, endingFrequency: 45, waveform: "sine" },
};

export function createAudioPlayer() {
  let audio: AudioContext | null = null;
  function play(kind: Sound) {
    try {
      if (!audio) {
        audio = new AudioContext();
      }

      audio.resume()
        .catch(() => {});
      const startSeconds = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const tone = tones[kind];

      oscillator.type = tone.waveform;
      oscillator.frequency.setValueAtTime(tone.frequency, startSeconds);
      oscillator.frequency.exponentialRampToValueAtTime(tone.endingFrequency, startSeconds + 0.14);
      gain.gain.setValueAtTime(0.0001, startSeconds);
      gain.gain.exponentialRampToValueAtTime(0.045, startSeconds + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startSeconds + 0.17);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(startSeconds);
      oscillator.stop(startSeconds + 0.18);
    } catch (error) {
      console.warn("Sound unavailable", error);
    }
  }

  return {
    play,
    suspend: () => {
      audio?.suspend()
        .catch(() => {});
    },
    dispose: () => {
      const current = audio;
      audio = null;
      current?.close()
        .catch(() => {});
    },
  };
}
