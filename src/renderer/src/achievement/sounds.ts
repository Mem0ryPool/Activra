import type { AchievementStyle, BuiltInSound } from '../../../shared/themes'

/**
 * Built-in sounds are tones synthesized at runtime with Web Audio. Imported files play through an
 * <audio> element.
 */
let context: AudioContext | null = null

interface Note {
  freq: number
  at: number
  length: number
  type: OscillatorType
  gain: number
}

const PRESETS: Record<BuiltInSound, Note[]> = {
  // Two calm notes.
  soft: [
    { freq: 659.25, at: 0, length: 0.9, type: 'triangle', gain: 1 },
    { freq: 987.77, at: 0.12, length: 1, type: 'triangle', gain: 0.9 }
  ],
  // Quick rising major arpeggio.
  bright: [
    { freq: 659.25, at: 0, length: 0.5, type: 'sine', gain: 0.9 },
    { freq: 830.61, at: 0.08, length: 0.5, type: 'sine', gain: 0.9 },
    { freq: 987.77, at: 0.16, length: 0.9, type: 'sine', gain: 1 },
    { freq: 1975.5, at: 0.16, length: 0.6, type: 'sine', gain: 0.25 }
  ],
  // Ceremonial: rising triad, then a held octave over a low root.
  fanfare: [
    { freq: 130.81, at: 0, length: 1.8, type: 'triangle', gain: 0.55 },
    { freq: 523.25, at: 0, length: 0.35, type: 'sawtooth', gain: 0.45 },
    { freq: 659.25, at: 0.14, length: 0.35, type: 'sawtooth', gain: 0.45 },
    { freq: 783.99, at: 0.28, length: 0.4, type: 'sawtooth', gain: 0.45 },
    { freq: 1046.5, at: 0.46, length: 1.5, type: 'sawtooth', gain: 0.55 },
    { freq: 1568, at: 0.46, length: 1.2, type: 'sine', gain: 0.3 },
    { freq: 2093, at: 0.46, length: 1, type: 'sine', gain: 0.15 }
  ]
}

/** The synthesized sound that is playing, so a newer notification can cut it off. */
let voice: { master: GainNode; oscillators: OscillatorNode[] } | null = null

function playPreset(preset: BuiltInSound, volume: number): void {
  context ??= new AudioContext()
  const ctx = context
  // A context Chromium suspended (e.g. a window that had no sound for a while) plays nothing until resumed.
  if (ctx.state === 'suspended') ctx.resume().catch((error: unknown) => console.warn('Achievement sound could not resume', error))
  const start = ctx.currentTime + 0.02
  const master = ctx.createGain()
  master.gain.value = Math.min(1, volume) * 0.3
  // Soften the sawtooth edges.
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 3200
  filter.connect(master).connect(ctx.destination)
  const oscillators: OscillatorNode[] = []

  for (const note of PRESETS[preset]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = note.type
    osc.frequency.value = note.freq
    const t0 = start + note.at
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(note.gain, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + note.length)
    osc.connect(gain).connect(filter)
    osc.start(t0)
    osc.stop(t0 + note.length + 0.05)
    oscillators.push(osc)
  }
  const played = { master, oscillators }
  voice = played
  // Forget the voice once every note has finished on its own.
  let remaining = oscillators.length
  for (const osc of oscillators) {
    osc.addEventListener('ended', () => {
      remaining -= 1
      if (remaining === 0 && voice === played) voice = null
    })
  }
}

let current: HTMLAudioElement | null = null

/** Silences whatever achievement sound is playing, synthesized or imported. */
export function stopAchievementSound(): void {
  current?.pause()
  current = null
  const playing = voice
  voice = null
  if (!playing) return
  for (const osc of playing.oscillators) {
    try {
      osc.stop()
    } catch {
      // Already stopped.
    }
  }
  playing.master.disconnect()
}

/** Plays the sound for a notification, cutting off the previous one first. */
export function playAchievementSound(style: Pick<AchievementStyle, 'sound' | 'soundUrl' | 'volume'>): void {
  stopAchievementSound()
  if (style.volume <= 0) return
  const url = style.soundUrl
  if (url) {
    const audio = new Audio(url)
    audio.volume = Math.min(1, style.volume)
    current = audio
    audio.play().catch((error) => console.warn('Achievement sound failed', error))
    return
  }
  if (style.sound === 'none') return
  try {
    playPreset(style.sound, style.volume)
  } catch (error) {
    // No sound is better than a broken notification: the card (or check-in) goes on without it.
    console.warn('Achievement sound failed', error)
  }
}
