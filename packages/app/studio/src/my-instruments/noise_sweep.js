// @label Noise Sweep
// @group Noise red
// @param noise      0.8
// @param tone       0.5
// @param filter     0    0     1     linear
// @group Amp green
// @param attack     0.5   0.01  4.0   exp     s
// @param decay      0.8   0.05  6.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {noise: 0.8, tone: 0.5, filter: 0, attack: 0.5, decay: 0.8, volume: 0.7}
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {attack, decay} = this.params
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, velocity,
            env: 0, attackRate: 1 / Math.max(1, attack * sampleRate),
            decayCoef: Math.exp(-7 / (decay * sampleRate)),
            releasing: false, peaked: false,
            bpLow: 0, bpBand: 0,
            lp1: 0,
            phase: 0
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
        const {noise, tone, filter, volume} = this.params
        const bpF = 2 * Math.sin(Math.PI * (1000 + tone * 5000) / sampleRate)
        const bpQ = 0.3 + filter * 4
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            let {env, bpLow, bpBand, lp1, phase, peaked} = voice
            const {attackRate, decayCoef, velocity, releasing} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) {
                    env *= decayCoef
                } else if (!peaked) {
                    env += attackRate
                    if (env >= 1) { env = 1; peaked = true }
                } else {
                    env *= decayCoef
                }
                const white = Math.random() * 2 - 1
                lp1 += 0.15 * (white - lp1)
                const pink = lp1
                bpLow += bpF * bpBand
                const high = pink - bpLow - bpQ * bpBand
                bpBand += bpF * high
                if (bpBand > 200) bpBand = 200; else if (bpBand < -200) bpBand = -200
                const out = bpBand * env * velocity * noise
                outL[s] += out
                outR[s] += out
            }
            voice.env = env; voice.bpLow = bpLow; voice.bpBand = bpBand; voice.lp1 = lp1; voice.phase = phase; voice.peaked = peaked
            if (env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s] * volume * 10.0)
            outR[s] = Math.tanh(outR[s] * volume * 10.0)
        }
    }
}