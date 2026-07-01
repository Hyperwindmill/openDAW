// @label Riser
// @group Sweep orange
// @param startFreq  200   50    2000  exp     Hz
// @param endFreq    8000  1000  16000 exp     Hz
// @param sweepTime  1.5   0.2   8.0   exp     s
// @group Noise red
// @param noise      0.7
// @param tone       0.5
// @group Amp green
// @param release    0.3   0.05  3.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {startFreq: 200, endFreq: 8000, sweepTime: 1.5, noise: 0.7, tone: 0.5, release: 0.3, volume: 0.7}
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {startFreq, endFreq, sweepTime, release} = this.params
        const pitchMul = Math.pow(2, (pitch - 60) / 12)
        const f0 = startFreq * pitchMul, f1 = endFreq * pitchMul
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, velocity,
            currentFreq: f0, startFreq: f0, endFreq: f1,
            sweepCoef: 1 / (sweepTime * sampleRate),
            env: 0,
            releaseCoef: Math.exp(-7 / (release * sampleRate)),
            releasing: false, peaked: false,
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
            let {currentFreq, env, bpLow, bpBand, lp1, sweepPos, peaked} = voice
            const {startFreq, endFreq, sweepCoef, releaseCoef, velocity, releasing} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) {
                    env *= releaseCoef
                } else if (!peaked) {
                    sweepPos += sweepCoef
                    if (sweepPos >= 1) { sweepPos = 1; peaked = true }
                    env = sweepPos
                } else {
                    env *= releaseCoef
                }
                currentFreq = startFreq + (endFreq - startFreq) * sweepPos
                if (currentFreq > sampleRate * 0.45) currentFreq = sampleRate * 0.45
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
            voice.lp1 = lp1; voice.sweepPos = sweepPos; voice.peaked = peaked
            if (env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s] * volume * 10.0)
            outR[s] = Math.tanh(outR[s] * volume * 10.0)
        }
    }
}