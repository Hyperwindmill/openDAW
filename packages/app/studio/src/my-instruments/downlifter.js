// @label Downlifter
// @group Sweep orange
// @param startFreq  8000  1000  16000 exp     Hz
// @param endFreq    200   50    2000  exp     Hz
// @param sweepTime  1.0   0.2   6.0   exp     s
// @group Noise red
// @param noise      0.7
// @param tone       0.5
// @group Amp green
// @param attack     0.1   0.001 0.5   exp     s
// @param release    0.3   0.05  3.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {startFreq: 8000, endFreq: 200, sweepTime: 1.0, noise: 0.7, tone: 0.5, attack: 0.1, release: 0.3, volume: 0.7}
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {startFreq, endFreq, sweepTime, attack, release} = this.params
        const pitchMul = Math.pow(2, (pitch - 60) / 12)
        const f0 = startFreq * pitchMul, f1 = endFreq * pitchMul
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, velocity,
            currentFreq: f0, startFreq: f0, endFreq: f1,
            sweepCoef: 1 / (sweepTime * sampleRate),
            env: 0, attackRate: 1 / Math.max(1, attack * sampleRate),
            releaseCoef: Math.exp(-7 / (release * sampleRate)),
            releasing: false, peaked: false, sweeping: true,
            bpLow: 0, bpBand: 0,
            lp1: 0,
            sweepPos: 0
        })
    }
    noteOff(id) {
        for (const voice of this.voices) {
            if (voice.id === id && !voice.releasing) voice.releasing = true
        }
    }
    reset() {
        const fast = Math.exp(-7 / (0.005 * sampleRate))
        for (const voice of this.voices) {
            voice.releasing = true
            voice.releaseCoef = fast
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {noise, tone, volume} = this.params
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            let {currentFreq, env, bpLow, bpBand, lp1, sweepPos, peaked, sweeping} = voice
            const {startFreq, endFreq, sweepCoef, attackRate, releaseCoef, velocity, releasing} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) {
                    env *= releaseCoef
                } else if (sweeping) {
                    if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                    sweepPos += sweepCoef
                    if (sweepPos >= 1) { sweepPos = 1; sweeping = false; peaked = true }
                    env = 1 - sweepPos * sweepPos * 0.8
                } else {
                    env *= releaseCoef
                }
                currentFreq = startFreq + (endFreq - startFreq) * sweepPos
                if (currentFreq < 30) currentFreq = 30
                const bpF = 2 * Math.sin(Math.PI * currentFreq / sampleRate)
                const bpQ = 0.5 + tone * 3
                const white = Math.random() * 2 - 1
                lp1 += 0.15 * (white - lp1)
                const pink = lp1
                bpLow += bpF * bpBand
                const high = pink - bpLow - bpQ * bpBand
                bpBand += bpF * high
                if (bpBand > 200) bpBand = 200; else if (bpBand < -200) bpBand = -200
                const out = bpBand * env * env * velocity * noise
                outL[s] += out
                outR[s] += out
            }
            voice.currentFreq = currentFreq; voice.env = env; voice.bpLow = bpLow; voice.bpBand = bpBand
            voice.lp1 = lp1; voice.sweepPos = sweepPos; voice.peaked = peaked; voice.sweeping = sweeping
            if (env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s] * volume * 10.0)
            outR[s] = Math.tanh(outR[s] * volume * 10.0)
        }
    }
}