// @label Vowel Bass
// @group Source orange
// @param detune     20   0     50    linear  ct
// @param tone       0.5
// @param sub        0.5
// @group Vowel blue
// @param vowel      0    0     4     linear
// @param morphLFO   0    0     16    exp     Hz
// @param morphDepth 0.6
// @group Formant purple
// @param formant    0.5
// @group Drive yellow
// @param drive      0.4
// @group Amp green
// @param attack     0.02 0.001 2.0   exp     s
// @param release    0.3  0.01  4.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {detune: 20, tone: 0.5, sub: 0.5, vowel: 0, morphLFO: 0, morphDepth: 0.6, formant: 0.5, drive: 0.4, attack: 0.02, release: 0.3, volume: 0.7}
        this.lfoPhase = 0
        this.fLow = [0,0,0,0,0,0]
        this.fBand = [0,0,0,0,0,0]
        this.preLp = 0
        this.preRp = 0
        this.tmpF = [0,0,0]
        this.tmpFc = [0,0,0]
        this.vowels = [
            [800, 1150, 2900],
            [400, 1700, 2600],
            [350, 1900, 2800],
            [450, 800, 2830],
            [325, 700, 2530]
        ]
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
            p1: 0, p2: 0, ps: 0,
            inc1: freq / ratio / sampleRate,
            inc2: freq * ratio / sampleRate,
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
        const {sub, tone, vowel, morphLFO, morphDepth, formant, drive, volume} = this.params
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {inc1, inc2, incSub, attackRate, releaseCoef, releasing, level} = voice
            let {p1, p2, ps, env} = voice
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                p1 += inc1; if (p1 >= 1) p1 -= 1
                p2 += inc2; if (p2 >= 1) p2 -= 1
                const saw1 = 2 * p1 - 1, saw2 = 2 * p2 - 1
                const mono = (saw1 + saw2) * 0.5
                const amp = env * level
                outL[s] += mono * amp
                outR[s] += mono * amp
                const subv = Math.sin(2 * Math.PI * ps)
                ps += incSub; if (ps >= 1) ps -= 1
                outL[s] += subv * sub * amp
                outR[s] += subv * sub * amp
            }
            voice.p1 = p1; voice.p2 = p2; voice.ps = ps; voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        let lfoPhase = this.lfoPhase
        const fLow = this.fLow, fBand = this.fBand
        const vowels = this.vowels
        const tmpF = this.tmpF, tmpFc = this.tmpFc
        const lfoInc = morphLFO / sampleRate
        const q = 1 / (0.5 + formant * 3)
        const preGain = 1 + drive * 6
        const toneCoef = 0.1 + 0.8 * tone
        let preLp = this.preLp, preRp = this.preRp
        for (let s = block.s0; s < block.s1; s++) {
            preLp += toneCoef * (outL[s] - preLp)
            preRp += toneCoef * (outR[s] - preRp)
            const srcL = preLp, srcR = preRp
            let morphPos = vowel
            if (morphLFO > 0) {
                const lfo = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhase)
                morphPos += (lfo - 0.5) * 2 * morphDepth * 2
                lfoPhase += lfoInc; if (lfoPhase >= 1) lfoPhase -= 1
            }
            if (morphPos < 0) morphPos = 0; else if (morphPos > 4) morphPos = 4
            const idx = morphPos | 0
            const frac = morphPos - idx
            const i0 = idx >= 4 ? 4 : idx
            const i1 = idx >= 4 ? 4 : idx + 1
            for (let m = 0; m < 3; m++) {
                tmpF[m] = vowels[i0][m] + (vowels[i1][m] - vowels[i0][m]) * frac
                tmpFc[m] = 2 * Math.sin(Math.PI * tmpF[m] / sampleRate)
            }
            let formantL = 0
            for (let m = 0; m < 3; m++) {
                const f = tmpFc[m]
                fLow[m] += f * fBand[m]
                const highL = srcL - fLow[m] - q * fBand[m]
                fBand[m] += f * highL
                if (fBand[m] > 200) fBand[m] = 200; else if (fBand[m] < -200) fBand[m] = -200
                formantL += fBand[m]
            }
            let formantR = 0
            for (let m = 0; m < 3; m++) {
                const f = tmpFc[m]
                const ri = m + 3
                fLow[ri] += f * fBand[ri]
                const highR = srcR - fLow[ri] - q * fBand[ri]
                fBand[ri] += f * highR
                if (fBand[ri] > 200) fBand[ri] = 200; else if (fBand[ri] < -200) fBand[ri] = -200
                formantR += fBand[ri]
            }
            outL[s] = Math.tanh(formantL * preGain * 0.33) * volume
            outR[s] = Math.tanh(formantR * preGain * 0.33) * volume
        }
        this.lfoPhase = lfoPhase
        this.preLp = preLp; this.preRp = preRp
    }
}