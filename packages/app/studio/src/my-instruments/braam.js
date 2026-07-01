// @label Braam
// @group Source orange
// @param tune       45    20    120   exp     Hz
// @param detune     20    0     50    linear  ct
// @param sub        0.6
// @group Filter purple
// @param brightness 0.3
// @param reso       0.6
// @group Drive yellow
// @param drive      0.5
// @group Amp green
// @param attack     0.15  0.01  1.0   exp     s
// @param release    1.5   0.1   6.0   exp     s
// @param volume     0.8

class Processor {
    constructor() {
        this.voices = []
        this.params = {tune: 45, detune: 20, sub: 0.6, brightness: 0.3, reso: 0.6, drive: 0.5, attack: 0.15, release: 1.5, volume: 0.8}
        this.lpLowL = 0; this.lpBandL = 0
        this.lpLowR = 0; this.lpBandR = 0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {tune, detune, attack, release} = this.params
        const freq = tune * Math.pow(2, (pitch - 36) / 12)
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
            voice.releaseCoef = Math.exp(-7 / (0.005 * sampleRate))
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {sub, brightness, reso, drive, volume} = this.params
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
                const saw1 = 2 * p1 - 1, saw2 = 2 * p2 - 1, saw3 = 2 * p3 - 1
                const mono = (saw1 + saw2 + saw3) * 0.333
                const amp = env * level
                outL[s] += mono * amp
                outR[s] += mono * amp
                const subv = Math.sin(2 * Math.PI * ps)
                ps += incSub; if (ps >= 1) ps -= 1
                outL[s] += subv * sub * amp
                outR[s] += subv * sub * amp
            }
            voice.p1 = p1; voice.p2 = p2; voice.p3 = p3; voice.ps = ps; voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        const co = 100 + brightness * 4000
        const f = 2 * Math.sin(Math.PI * co / sampleRate)
        const q = 1 / (0.5 + reso * 12)
        const preGain = 1 + drive * 6
        let lpLowL = this.lpLowL, lpBandL = this.lpBandL, lpLowR = this.lpLowR, lpBandR = this.lpBandR
        for (let s = block.s0; s < block.s1; s++) {
            const inL = Math.tanh(outL[s] * preGain)
            lpLowL += f * lpBandL
            const highL = inL - lpLowL - q * lpBandL
            lpBandL += f * highL
            if (lpBandL > 200) lpBandL = 200; else if (lpBandL < -200) lpBandL = -200
            const inR = Math.tanh(outR[s] * preGain)
            lpLowR += f * lpBandR
            const highR = inR - lpLowR - q * lpBandR
            lpBandR += f * highR
            if (lpBandR > 200) lpBandR = 200; else if (lpBandR < -200) lpBandR = -200
            outL[s] = Math.tanh((lpLowL + lpBandL * 0.5) * volume)
            outR[s] = Math.tanh((lpLowR + lpBandR * 0.5) * volume)
        }
        this.lpLowL = lpLowL; this.lpBandL = lpBandL; this.lpLowR = lpLowR; this.lpBandR = lpBandR
    }
}