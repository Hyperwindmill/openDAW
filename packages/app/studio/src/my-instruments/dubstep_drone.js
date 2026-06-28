// @label Dubstep Drone
// @group Osc orange
// @param detune   25   0     50    linear  ct
// @param sub      0.6
// @group Wobble red
// @param wobble   3    0.25  24    exp     Hz
// @param shape    0    0     3     int
// @param depth    0.8
// @group Filter purple
// @param cutoff   350  60    4000  exp     Hz
// @param reso     0.7
// @group Drive yellow
// @param drive    0.5
// @group Amp green
// @param attack   0.02 0.001 2.0   exp     s
// @param release  0.3  0.01  4.0   exp     s
// @param volume   0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {detune: 25, sub: 0.6, wobble: 3, shape: 0, depth: 0.8, cutoff: 350, reso: 0.7, drive: 0.5, attack: 0.02, release: 0.3, volume: 0.7}
        this.lfoPhase = 0
        this.low = 0
        this.band = 0
        this.dcX = 0
        this.dcY = 0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {detune, attack, release} = this.params
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        const ratio = Math.pow(2, detune / 1200)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, gate: true, releasing: false, env: 0, level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * sampleRate),
            releaseCoef: Math.exp(-7 / (release * sampleRate)),
            p1: 0, p2: 0, p3: 0, ps: 0,
            inc1: freq / ratio / sampleRate,
            inc2: freq / sampleRate,
            inc3: freq * ratio / sampleRate,
            incSub: freq * 0.5 / sampleRate
        })
    }
    noteOff(id) {
        for (const voice of this.voices) {
            if (voice.id === id && !voice.releasing) voice.releasing = true
        }
    }
    reset() {
        for (const voice of this.voices) {
            voice.releasing = true
            voice.releaseCoef = Math.exp(-7 / (0.01 * sampleRate))
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {sub, wobble, shape, depth, cutoff, reso, drive, volume} = this.params
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {inc1, inc2, inc3, incSub, attackRate, releaseCoef, releasing, level} = voice
            let {p1, p2, p3, ps, env} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                p1 += inc1; if (p1 >= 1) p1 -= 1
                p2 += inc2; if (p2 >= 1) p2 -= 1
                p3 += inc3; if (p3 >= 1) p3 -= 1
                const saw = ((2 * p1 - 1) + (2 * p2 - 1) + (2 * p3 - 1)) * 0.333
                const subv = Math.sin(2 * Math.PI * ps)
                ps += incSub; if (ps >= 1) ps -= 1
                const out = (saw + subv * sub) * env * level
                outL[s] += out
                outR[s] += out
            }
            voice.p1 = p1; voice.p2 = p2; voice.p3 = p3; voice.ps = ps; voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        let lfoPhase = this.lfoPhase, low = this.low, band = this.band, dcX = this.dcX, dcY = this.dcY
        const lfoInc = wobble / sampleRate
        const q = 1 / (0.7 + reso * 12)
        const dr = 1 + drive * 8
        const sh = shape | 0
        for (let s = block.s0; s < block.s1; s++) {
            let lv
            if (sh === 0) lv = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhase)
            else if (sh === 1) lv = 1 - Math.abs(2 * lfoPhase - 1)
            else if (sh === 2) lv = 1 - lfoPhase
            else lv = lfoPhase < 0.5 ? 1 : 0
            lfoPhase += lfoInc; if (lfoPhase >= 1) lfoPhase -= 1
            let co = cutoff * Math.exp(depth * lv * 3)
            if (co > 6000) co = 6000; else if (co < 40) co = 40
            const f = 2 * Math.sin(Math.PI * co / sampleRate)
            const inp = outL[s]
            low += f * band
            const high = inp - low - q * band
            band += f * high
            if (band > 200) band = 200; else if (band < -200) band = -200
            dcY = low - dcX + 0.995 * dcY
            dcX = low
            const o = Math.tanh(dcY * dr) * volume
            outL[s] = o
            outR[s] = o
        }
        this.lfoPhase = lfoPhase; this.low = low; this.band = band; this.dcX = dcX; this.dcY = dcY
    }
}
