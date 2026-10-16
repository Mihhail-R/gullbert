import type { Sound } from "../simulation/model.js";

export function createAudioPlayer() {
  let audio: AudioContext | null = null;
  function play(kind: Sound) {
    try {
      if (!audio) {
        audio = new AudioContext();
      }

      audio.resume()
        .catch(() => {});
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      let frequency = 130;
      let endingFrequency = 45;
      osc.type = "sine";

      if (kind === "squawk") {
        osc.type = "sawtooth";
        frequency = 760;
        endingFrequency = 310;
      } else if (kind === "pop") {
        frequency = 980;
      } else if (kind === "splash") {
        frequency = 410;
      } else if (kind === "munch") {
        frequency = 240;
      }

      osc.frequency.setValueAtTime(frequency, t);
      osc.frequency.exponentialRampToValueAtTime(endingFrequency, t + 0.14);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } catch (e) {
      console.warn("Sound unavailable", e);
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
