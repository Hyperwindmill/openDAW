// @label Yoi Bass
// @group Source orange
// @param detune     20   0     50    linear  ct
// @param tone       0.5
// @param sub        0.5
// @group Glide blue
// @param fromVowel  2    0     4     int
// @param toVowel    0    0     4     int
// @param glideTime  0.15 0.01  1.0   exp     s
// @group Formant purple
// @param formant    0.5
// @group Drive yellow
// @param drive      0.4
// @group Amp green
// @param attack     0.01 0.001 1.0   exp     s
// @param release    0.3  0.01  4.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {detune: 20, tone: 0.5, sub: 0.5, fromVowel: 2, toVowel: 0, glideTime: 0.15, formant: 0.5, drive: 0.4, attack: 0.01, release: 0.3, volume: 0.7}
        this.vowels = [
            [800, 1150, 2900],
            [400, 1700, 2600],
            [350, 1900, 2800],
            [450, 800, 2830],
            [325, 700, 2530]
        ]
        this.tmpFc = [0,0,0]
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {detune, attack, release, glideTime, fromVowel, toVowel} = this.params
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        const ratio = Math.pow(2, detune / 1200)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, gate: true, releasing: false, env: 0, level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * sampleRate),
            releaseCoef: Math.exp(-7 / (release * sampleRate)),
            p1: 0, p2: 0, ps: 0,
            inc1: freq / ratio / sampleRate,
            inc2: freq * ratio / sampleRate,
            incSub: freq * 0.5 / sampleRate,
            vowelPos: fromVowel, vowelStart: fromVowel, vowelEnd: toVowel,
            glideCoef: 1 - Math.exp(-1 / (glideTime * sampleRate)),
            fLow: [0,0,0], fBand: [0,0,0]
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
        const {sub, tone, formant, drive, volume} = this.params
        const vowels = this.vowels
        const tmpFc = this.tmpFc
        const q = 1 / (0.5 + formant * 3)
        const preGain = 1 + drive * 6
        const toneCoef = 0.1 + 0.8 * tone
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {inc1, inc2, incSub, attackRate, releaseCoef, releasing, level, glideCoef, vowelEnd} = voice
            let {p1, p2, ps, env, vowelPos} = voice
            const fLow = voice.fLow, fBand = voice.fBand
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                vowelPos += (vowelEnd - vowelPos) * glideCoef
                p1 += inc1; if (p1 >= 1) p1 -= 1
                p2 += inc2; if (p2 >= 1) p2 -= 1
                const saw1 = 2 * p1 - 1, saw2 = 2 * p2 - 1
                let src = (saw1 + saw2) * 0.5
                let lp = 0
                lp += toneCoef * (src - lp)
                src = lp
                const subv = Math.sin(2 * Math.PI * ps)
                ps += incSub; if (ps >= 1) ps -= 1
                src += subv * sub
                let morphPos = vowelPos
                if (morphPos < 0) morphPos = 0; else if (morphPos > 4) morphPos = 4
                const idx = morphPos | 0
                const frac = morphPos - idx
                const i0 = idx >= 4 ? 4 : idx
                const i1 = idx >= 4 ? 4 : idx + 1
                for (let m = 0; m < 3; m++) {
                    const fc = vowels[i0][m] + (vowels[i1][m] - vowels[i0][m]) * frac
                    tmpFc[m] = 2 * Math.sin(Math.PI * fc / sampleRate)
                }
                let formantOut = 0
                for (let m = 0; m < 3; m++) {
                    const f = tmpFc[m]
                    fLow[m] += f * fBand[m]
                    const high = src - fLow[m] - q * fBand[m]
                    fBand[m] += f * high
                    if (fBand[m] > 200) fBand[m] = 200; else if (fBand[m] < -200) fBand[m] = -200
                    formantOut += fBand[m]
                }
                const amp = env * level
                const out = Math.tanh(formantOut * preGain * 0.33) * volume * amp
                outL[s] += out
                outR[s] += out
            }
            voice.p1 = p1; voice.p2 = p2; voice.ps = ps; voice.env = env; voice.vowelPos = vowelPos
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            outL[s] = Math.tanh(outL[s])
            outR[s] = Math.tanh(outR[s])
        }
    }
}