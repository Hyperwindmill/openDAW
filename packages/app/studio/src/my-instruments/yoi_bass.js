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
// @group Stereo cyan
// @param width      0.5  0     1     linear
// @group Amp green
// @param attack     0.01 0.001 1.0   exp     s
// @param release    0.3  0.01  4.0   exp     s
// @param volume     0.7

const polyBlep = (t, dt) => {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1 }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1 }
    return 0
}

class Processor {
    constructor() {
        this.voices = []
        this.params = {detune: 20, tone: 0.5, sub: 0.5, fromVowel: 2, toVowel: 0, glideTime: 0.15, formant: 0.5, drive: 0.4, width: 0.5, attack: 0.01, release: 0.3, volume: 0.7}
        this.fs2 = sampleRate * 2
        this.decZ1L = 0; this.decZ2L = 0; this.decZ1R = 0; this.decZ2R = 0
        this.tmpFL = [0,0,0]
        this.vowels = [
            [800, 1150, 2900],
            [400, 1700, 2600],
            [350, 1900, 2800],
            [450, 800, 2830],
            [325, 700, 2530]
        ]
        const fcDec = sampleRate * 0.45
        const w0 = 2 * Math.PI * fcDec / this.fs2, cosw = Math.cos(w0), sinw = Math.sin(w0), Q = 0.70710678
        const alpha = sinw / (2 * Q), b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2, a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha
        this.dB0 = b0 / a0; this.dB1 = b1 / a0; this.dB2 = b2 / a0; this.dA1 = a1 / a0; this.dA2 = a2 / a0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {detune, attack, release, glideTime, fromVowel, toVowel} = this.params
        const fs2 = this.fs2
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        const ratio = Math.pow(2, detune / 1200)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, gate: true, releasing: false, env: 0, level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * fs2),
            releaseCoef: Math.exp(-7 / (release * fs2)),
            p1: 0, p2: 0, ps: 0,
            inc1: freq / ratio / fs2,
            inc2: freq * ratio / fs2,
            incSub: freq * 0.5 / fs2,
            vowelPos: fromVowel, vowelEnd: toVowel,
            glideCoef: 1 - Math.exp(-1 / (glideTime * fs2)),
            toneL: 0, toneR: 0,
            f0Ic1L: 0, f0Ic2L: 0, f0Ic1R: 0, f0Ic2R: 0,
            f1Ic1L: 0, f1Ic2L: 0, f1Ic1R: 0, f1Ic2R: 0,
            f2Ic1L: 0, f2Ic2L: 0, f2Ic1R: 0, f2Ic2R: 0
        })
    }
    noteOff(id) {
        for (const voice of this.voices) {
            if (voice.id === id && !voice.releasing) voice.releasing = true
        }
    }
    reset() {
        const fs2 = this.fs2
        for (const voice of this.voices) {
            voice.releasing = true
            voice.releaseCoef = Math.exp(-7 / (0.005 * fs2))
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {sub, tone, formant, drive, width, volume} = this.params
        const fs2 = this.fs2
        const vowels = this.vowels
        const tmpFL = this.tmpFL
        const k = Math.max(0.05, 1 / (1 + formant * 11))
        const preGain = 1 + drive * 6
        const toneCoefOS = 1 - Math.sqrt(1 - (0.1 + 0.8 * tone))
        const wLeft = 0.5 + width * 0.5, wRight = 0.5 - width * 0.5
        const {dB0, dB1, dB2, dA1, dA2} = this
        let decZ1L = this.decZ1L, decZ2L = this.decZ2L, decZ1R = this.decZ1R, decZ2R = this.decZ2R
        for (let s = block.s0; s < block.s1; s++) {
            let dryL = 0, dryR = 0
            for (let os = 0; os < 2; os++) {
                let sumL = 0, sumR = 0
                for (let v = this.voices.length - 1; v >= 0; v--) {
                    const voice = this.voices[v]
                    const {inc1, inc2, incSub, attackRate, releaseCoef, releasing, level, glideCoef, vowelEnd} = voice
                    let env = voice.env
                    if (releasing) env *= releaseCoef
                    else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                    let vowelPos = voice.vowelPos + (vowelEnd - voice.vowelPos) * glideCoef
                    let p1 = voice.p1 + inc1; if (p1 >= 1) p1 -= 1
                    let p2 = voice.p2 + inc2; if (p2 >= 1) p2 -= 1
                    const saw1 = (2 * p1 - 1) - polyBlep(p1, inc1)
                    const saw2 = (2 * p2 - 1) - polyBlep(p2, inc2)
                    const subv = Math.sin(2 * Math.PI * voice.ps)
                    let ps = voice.ps + incSub; if (ps >= 1) ps -= 1
                    let srcL = saw1 * wLeft + saw2 * wRight
                    let srcR = saw1 * wRight + saw2 * wLeft
                    let toneL = voice.toneL + toneCoefOS * (srcL - voice.toneL)
                    let toneR = voice.toneR + toneCoefOS * (srcR - voice.toneR)
                    const subMono = subv * sub
                    srcL = toneL + subMono
                    srcR = toneR + subMono
                    let morphPos = vowelPos
                    if (morphPos < 0) morphPos = 0; else if (morphPos > 4) morphPos = 4
                    const idx = morphPos | 0, frac = morphPos - idx, i0 = idx >= 4 ? 4 : idx, i1 = idx >= 4 ? 4 : idx + 1
                    for (let m = 0; m < 3; m++) tmpFL[m] = vowels[i0][m] + (vowels[i1][m] - vowels[i0][m]) * frac
                    let f0Ic1L = voice.f0Ic1L, f0Ic2L = voice.f0Ic2L, f1Ic1L = voice.f1Ic1L, f1Ic2L = voice.f1Ic2L, f2Ic1L = voice.f2Ic1L, f2Ic2L = voice.f2Ic2L
                    let f0Ic1R = voice.f0Ic1R, f0Ic2R = voice.f0Ic2R, f1Ic1R = voice.f1Ic1R, f1Ic2R = voice.f1Ic2R, f2Ic1R = voice.f2Ic1R, f2Ic2R = voice.f2Ic2R
                    const g0L = Math.tan(Math.PI * tmpFL[0] / fs2), a10L = 1 / (1 + g0L * (g0L + k)), a20L = g0L * a10L
                    const v30L = srcL - f0Ic2L, v10L = a10L * f0Ic1L + a20L * v30L, v20L = f0Ic2L + a20L * f0Ic1L + g0L * a20L * v30L
                    f0Ic1L = 2 * v10L - f0Ic1L; f0Ic2L = 2 * v20L - f0Ic2L
                    const g1L = Math.tan(Math.PI * tmpFL[1] / fs2), a11L = 1 / (1 + g1L * (g1L + k)), a21L = g1L * a11L
                    const v31L = srcL - f1Ic2L, v11L = a11L * f1Ic1L + a21L * v31L, v21L = f1Ic2L + a21L * f1Ic1L + g1L * a21L * v31L
                    f1Ic1L = 2 * v11L - f1Ic1L; f1Ic2L = 2 * v21L - f1Ic2L
                    const g2L = Math.tan(Math.PI * tmpFL[2] / fs2), a12L = 1 / (1 + g2L * (g2L + k)), a22L = g2L * a12L
                    const v32L = srcL - f2Ic2L, v12L = a12L * f2Ic1L + a22L * v32L, v22L = f2Ic2L + a22L * f2Ic1L + g2L * a22L * v32L
                    f2Ic1L = 2 * v12L - f2Ic1L; f2Ic2L = 2 * v22L - f2Ic2L
                    const formantL = v10L + v11L + v12L
                    const g0R = Math.tan(Math.PI * tmpFL[0] / fs2), a10R = 1 / (1 + g0R * (g0R + k)), a20R = g0R * a10R
                    const v30R = srcR - f0Ic2R, v10R = a10R * f0Ic1R + a20R * v30R, v20R = f0Ic2R + a20R * f0Ic1R + g0R * a20R * v30R
                    f0Ic1R = 2 * v10R - f0Ic1R; f0Ic2R = 2 * v20R - f0Ic2R
                    const g1R = Math.tan(Math.PI * tmpFL[1] / fs2), a11R = 1 / (1 + g1R * (g1R + k)), a21R = g1R * a11R
                    const v31R = srcR - f1Ic2R, v11R = a11R * f1Ic1R + a21R * v31R, v21R = f1Ic2R + a21R * f1Ic1R + g1R * a21R * v31R
                    f1Ic1R = 2 * v11R - f1Ic1R; f1Ic2R = 2 * v21R - f1Ic2R
                    const g2R = Math.tan(Math.PI * tmpFL[2] / fs2), a12R = 1 / (1 + g2R * (g2R + k)), a22R = g2R * a12R
                    const v32R = srcR - f2Ic2R, v12R = a12R * f2Ic1R + a22R * v32R, v22R = f2Ic2R + a22R * f2Ic1R + g2R * a22R * v32R
                    f2Ic1R = 2 * v12R - f2Ic1R; f2Ic2R = 2 * v22R - f2Ic2R
                    const formantR = v10R + v11R + v12R
                    const amp = env * level
                    sumL += Math.tanh(formantL * preGain * 0.33) * volume * amp
                    sumR += Math.tanh(formantR * preGain * 0.33) * volume * amp
                    voice.p1 = p1; voice.p2 = p2; voice.ps = ps; voice.env = env; voice.vowelPos = vowelPos
                    voice.toneL = toneL; voice.toneR = toneR
                    voice.f0Ic1L = f0Ic1L; voice.f0Ic2L = f0Ic2L; voice.f1Ic1L = f1Ic1L; voice.f1Ic2L = f1Ic2L; voice.f2Ic1L = f2Ic1L; voice.f2Ic2L = f2Ic2L
                    voice.f0Ic1R = f0Ic1R; voice.f0Ic2R = f0Ic2R; voice.f1Ic1R = f1Ic1R; voice.f1Ic2R = f1Ic2R; voice.f2Ic1R = f2Ic1R; voice.f2Ic2R = f2Ic2R
                }
                const yL = dB0 * sumL + decZ1L; decZ1L = dB1 * sumL - dA1 * yL + decZ2L; decZ2L = dB2 * sumL - dA2 * yL
                const yR = dB0 * sumR + decZ1R; decZ1R = dB1 * sumR - dA1 * yR + decZ2R; decZ2R = dB2 * sumR - dA2 * yR
                dryL = yL; dryR = yR
            }
            outL[s] += Math.tanh(dryL)
            outR[s] += Math.tanh(dryR)
        }
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            if (voice.releasing && voice.env < 2e-4) this.voices.splice(v, 1)
        }
        this.decZ1L = decZ1L; this.decZ2L = decZ2L; this.decZ1R = decZ1R; this.decZ2R = decZ2R
    }
}