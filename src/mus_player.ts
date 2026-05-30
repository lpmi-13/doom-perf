/**
 * DOOM music player using Tone.js for MIDI playback.
 * Loads pre-converted MIDI files from /music/ and plays them with Tone.js synthesizers.
 */

import * as Tone from "tone";
import { Midi } from "@tonejs/midi";

// GM instrument categories for choosing synth types
const GUITAR_PROGRAMS = new Set([24, 25, 26, 27, 28, 29, 30, 31]);
const BASS_PROGRAMS = new Set([32, 33, 34, 35, 36, 37, 38, 39]);

function createSynthForProgram(program: number): Tone.PolySynth {
  if (GUITAR_PROGRAMS.has(program)) {
    return new Tone.PolySynth(Tone.FMSynth, {
      maxPolyphony: 6,
      voice: { oscillator: { type: "sawtooth" }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.2 } },
    });
  }
  if (BASS_PROGRAMS.has(program)) {
    return new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 4,
      voice: { oscillator: { type: "square" }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.15 } },
    });
  }
  return new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 6,
    voice: { oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } },
  });
}

export class MidiPlayer {
  private synths: Tone.PolySynth[] = [];
  private noiseSynth: Tone.NoiseSynth | null = null;
  private timeoutIds: ReturnType<typeof setTimeout>[] = [];
  private currentMidi: Midi | null = null;
  private playing = false;
  private volume = -8; // dB
  private loopTimerId: ReturnType<typeof setTimeout> | null = null;

  async loadUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(url);
      if (!response.ok) return false;
      const arrayBuffer = await response.arrayBuffer();
      this.currentMidi = new Midi(arrayBuffer);
      return true;
    } catch {
      return false;
    }
  }

  async play(loop = true): Promise<void> {
    if (!this.currentMidi) return;
    this.stop();
    this.playing = true;

    await Tone.start();
    const midi = this.currentMidi;
    const startTime = Tone.now() + 0.3;

    for (const track of midi.tracks) {
      if (track.notes.length === 0) continue;

      const isDrum = track.channel === 9;

      if (isDrum) {
        const noise = new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.03 },
          volume: this.volume - 8,
        }).toDestination();
        this.noiseSynth = noise;

        for (const note of track.notes) {
          const noteTime = startTime + note.time;
          const delayMs = Math.max(0, (noteTime - Tone.now()) * 1000);
          const id = setTimeout(() => {
            if (!this.playing) return;
            try { noise.triggerAttackRelease("32n"); } catch { /* ignore */ }
          }, delayMs);
          this.timeoutIds.push(id);
        }
        continue;
      }

      const program = track.instrument?.number ?? 0;
      const synth = createSynthForProgram(program);
      synth.volume.value = this.volume;
      synth.toDestination();
      this.synths.push(synth);

      for (const note of track.notes) {
        const noteTime = startTime + note.time;
        const delayMs = Math.max(0, (noteTime - Tone.now()) * 1000);
        const id = setTimeout(() => {
          if (!this.playing) return;
          try {
            synth.triggerAttackRelease(
              note.name,
              Math.max(note.duration, 0.05),
              undefined,
              note.velocity,
            );
          } catch {
            // ignore
          }
        }, delayMs);
        this.timeoutIds.push(id);
      }
    }

    // Handle looping
    if (loop && midi.duration > 0) {
      const loopDelay = midi.duration * 1000 + 500;
      this.loopTimerId = setTimeout(() => {
        if (this.playing) {
          this.cleanup();
          void this.play(true);
        }
      }, loopDelay);
    }
  }

  private cleanup(): void {
    for (const id of this.timeoutIds) {
      clearTimeout(id);
    }
    this.timeoutIds = [];
    for (const synth of this.synths) {
      synth.dispose();
    }
    this.synths = [];
    if (this.noiseSynth) {
      this.noiseSynth.dispose();
      this.noiseSynth = null;
    }
  }

  stop(): void {
    this.playing = false;
    if (this.loopTimerId !== null) {
      clearTimeout(this.loopTimerId);
      this.loopTimerId = null;
    }
    this.cleanup();
  }

  setVolume(vol: number): void {
    this.volume = vol;
    for (const synth of this.synths) {
      synth.volume.value = vol;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }
}

let playerInstance: MidiPlayer | null = null;

export const getMidiPlayer = (): MidiPlayer => {
  if (!playerInstance) {
    playerInstance = new MidiPlayer();
  }
  return playerInstance;
};
