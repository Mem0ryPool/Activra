import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Minimal Web Audio stand-ins: just enough to see what is still sounding. */
class FakeNode {
  connect<T>(next: T): T {
    return next
  }
  disconnect = vi.fn()
}
class FakeParam {
  value = 0
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}
const oscillators: FakeOscillator[] = []
class FakeOscillator extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  stoppedEarly = false
  private listeners: (() => void)[] = []
  constructor() {
    super()
    oscillators.push(this)
  }
  start(): void {}
  stop(when?: number): void {
    if (when === undefined) this.stoppedEarly = true
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener)
  }
  end(): void {
    for (const l of this.listeners) l()
  }
}
const masters: FakeNode[] = []
class FakeAudioContext {
  currentTime = 0
  destination = new FakeNode()
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam() })
    masters.push(node)
    return node
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam() })
  }
  createOscillator() {
    return new FakeOscillator()
  }
}
const audios: { pause: ReturnType<typeof vi.fn>; src: string }[] = []
class FakeAudio {
  volume = 1
  pause = vi.fn()
  constructor(public src: string) {
    audios.push(this)
  }
  play(): Promise<void> {
    return Promise.resolve()
  }
}

beforeEach(() => {
  vi.resetModules()
  oscillators.length = 0
  masters.length = 0
  audios.length = 0
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('Audio', FakeAudio)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const style = (sound: 'soft' | 'bright' | 'fanfare' | 'none', soundUrl: string | null = null) => ({ sound, soundUrl, volume: 0.8 })

describe('achievement sounds', () => {
  it('cuts off the previous synthesized sound when a new one starts', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('fanfare'))
    const fanfare = [...oscillators]
    // The first gain created per play is the master.
    const fanfareMaster = masters[0]!
    playAchievementSound(style('soft'))
    expect(fanfare.every((o) => o.stoppedEarly)).toBe(true)
    expect(fanfareMaster.disconnect).toHaveBeenCalled()
    expect(oscillators.slice(fanfare.length).some((o) => o.stoppedEarly)).toBe(false)
  })

  it('cuts off an imported sound, and a preset when an imported one starts', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('soft', 'lu-asset://asset/a.wav'))
    playAchievementSound(style('bright'))
    expect(audios[0]!.pause).toHaveBeenCalled()
    playAchievementSound(style('soft', 'lu-asset://asset/b.wav'))
    expect(oscillators.every((o) => o.stoppedEarly)).toBe(true)
  })

  it('a silent notification still stops the previous sound', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('bright'))
    playAchievementSound({ sound: 'bright', soundUrl: null, volume: 0 })
    expect(oscillators.every((o) => o.stoppedEarly)).toBe(true)
  })

  it('does not touch a sound that already finished on its own', async () => {
    const { playAchievementSound, stopAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('soft'))
    for (const o of oscillators) o.end()
    stopAchievementSound()
    expect(oscillators.some((o) => o.stoppedEarly)).toBe(false)
  })

  it('plays an imported sound as audio and cuts it off for the next one', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('bright', 'lu-asset://asset/a.wav'))
    expect(oscillators).toHaveLength(0)
    expect(audios[0]!.src).toBe('lu-asset://asset/a.wav')
    playAchievementSound(style('fanfare'))
    expect(audios[0]!.pause).toHaveBeenCalled()
  })

  it('a burst of 20 quick completions leaves only the latest sound playing', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    for (let i = 0; i < 20; i++) playAchievementSound(style('bright', 'lu-asset://asset/a.wav'))
    expect(audios).toHaveLength(20)
    expect(audios.slice(0, 19).every((a) => a.pause.mock.calls.length > 0)).toBe(true)
    expect(audios[19]!.pause).not.toHaveBeenCalled()
  })

  it('a summary interrupted by a new completion stops the summary sound at once', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('fanfare')) // the summary
    const summary = [...oscillators]
    playAchievementSound(style('bright', 'lu-asset://asset/a.wav')) // the next completion
    expect(summary.every((o) => o.stoppedEarly)).toBe(true)
    expect(audios[0]!.pause).not.toHaveBeenCalled()
  })
})

describe('sounds in quick succession (Phase 6.6.2)', () => {
  it('every play starts its own sound; a second one is never swallowed', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('soft'))
    const first = oscillators.length
    playAchievementSound(style('soft'))
    playAchievementSound(style('bright'))
    expect(first).toBeGreaterThan(0)
    // Three plays, three sets of notes; only the last is still sounding.
    expect(oscillators.length).toBe(first * 2 + 4)
    expect(oscillators.slice(-4).some((o) => o.stoppedEarly)).toBe(false)
  })

  it('resumes a suspended audio context', async () => {
    const resume = vi.fn(() => Promise.resolve())
    vi.stubGlobal('AudioContext', class extends FakeAudioContext {
      state = 'suspended'
      resume = resume
    })
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    playAchievementSound(style('soft'))
    expect(resume).toHaveBeenCalled()
  })

  it('a failing sound never throws and leaves no unhandled rejection', async () => {
    const rejected = vi.fn()
    process.on('unhandledRejection', rejected)
    vi.stubGlobal('AudioContext', class extends FakeAudioContext {
      state = 'suspended'
      resume = () => Promise.reject(new Error('blocked'))
      override createOscillator(): FakeOscillator {
        throw new Error('no audio device')
      }
    })
    vi.stubGlobal('Audio', class extends FakeAudio {
      override play(): Promise<void> {
        return Promise.reject(new Error('NotAllowedError'))
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    expect(() => playAchievementSound(style('soft'))).not.toThrow()
    expect(() => playAchievementSound(style('soft', 'lu-asset://asset/a.wav'))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', rejected)
    warn.mockRestore()
    expect(rejected).not.toHaveBeenCalled()
  })

  it('stays silent when sound is off or the volume is 0', async () => {
    const { playAchievementSound } = await import('../../src/renderer/src/achievement/sounds')
    const { habitCheckinSound } = await import('../../src/shared/habits/feedback')
    playAchievementSound(habitCheckinSound({ sound: 'none', volume: 0.8 }))
    playAchievementSound(habitCheckinSound({ sound: 'fanfare', volume: 0 }))
    expect(oscillators).toHaveLength(0)
    // The check-in tone is always the calm one, at the user's volume.
    expect(habitCheckinSound({ sound: 'fanfare', volume: 0.6 })).toEqual({ sound: 'soft', soundUrl: null, volume: 0.6 })
  })
})
