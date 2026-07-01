// @label Riser
// @group Sweep orange
// @param startFreq  200   50    2000  exp     Hz
// @param endFreq    8000  1000  16000 exp     Hz
// @param sweepTime  1.5   0.2   8.0   exp     s
// @group Noise red
// @param noise      0.7
// @param tone       0.5
// @group Amp green
// @param attack     0.05  0.001 2.0   exp     s
// @param decay      0.3   0.05  3.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {startFreq: 200, endFreq: 8000, sweepTime: 1.5, noise: 0.7, tone: 0.5, attack: 0.05, decay: 0.3, volume: 0.7}
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {startFreq, endFreq, sweepTime, attack, decay} = this.params
        const pitchMul = Math.pow(2, (pitch - 60) / 12)
        const f0 = startFreq * pitchMul, f1 = endFreq * pitchMul
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, velocity,
            currentFreq: f0, startFreq: f0, endFreq: f1,
            sweepCoef: 1 - Math.exp(-1 / (sweepTime * sampleRate)),
            env: 0, attackRate: 1 / Math.max(1, attack * sampleRate),
            decayCoef: Math.exp(-7 / (decay * sampleRate)),
            releasing: false, peaked: false,
            bpLow: 0, bpBand: 0,
            lp1: 0, lp2: 0,
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
            voice.decayCoef = fast
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {noise, tone, volume} = this.params
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            let {currentFreq, env, bpLow, bpBand, lp1, lp2, sweepPos, peaked} = voice
            const {startFreq, endFreq, sweepCoef, attackRate, decayCoef, velocity, releasing} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) {
                    env *= decayCoef
                } else if (!peaked) {
                    env += attackRate
                    if (env >= 1) { env = 1; peaked = true }
                } else {
                    env *= decayCoef
                }
                sweepPos += sweepCoef
                currentFreq = startFreq + (endFreq - startFreq) * sweepPos
                if (currentFreq > sampleRate * 0.45) currentFreq = sampleRate * 0.45
                const bpF = 2 * Math.sin(Math.PI * currentFreq / sampleRate)
                const bpQ = 0.5 + tone * 3
                const white = Math.random() * 2 - 1
                lp1 += 0.02 * (white - lp1)
                const pink = lp1
                bpLow += bpF * bpBand
                const high = pink - bpLow - bpQ * bpBand
                bpBand += bpF * high
                if (bpBand > 200) bpBand = 200; else if (bpBand < -200) bpBand = -200
                const out = bpBand * env * velocity * noise
                outL[s] += out
                outR[s] += out
            }
            voice.currentFreq = currentFreq; voice.env = env; voice.bpLow = bpLow; voice.bpBand = bpBand
            voice.lp1 = lp1; voice.lp2 = lp2; voice.sweepPos = sweepPos; voice.peaked = peaked
            if (env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s] * volume * 2.0)
            outR[s] = Math.tanh(outR[s] * volume * 2.0)
        }
    }
}