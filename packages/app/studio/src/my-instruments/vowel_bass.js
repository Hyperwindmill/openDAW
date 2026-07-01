// @label Vowel Bass
// @group Source orange
// @param detune     20   0     50    linear  ct
// @param tone       0.5
// @param sub        0.5
// @group Vowel blue
// @param vowel      0    0     4     linear
// @param morphLFO   0.1  0.1   16    exp     Hz
// @param morphDepth 0.6
// @group Formant purple
// @param formant    0.5
// @group Drive yellow
// @param drive      0.4
// @group Stereo cyan
// @param width      0.5   0     1     linear
// @group Amp green
// @param attack     0.02 0.001 2.0   exp     s
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
        this.params = {detune: 20, tone: 0.5, sub: 0.5, vowel: 0, morphLFO: 0, morphDepth: 0.6, formant: 0.5, drive: 0.4, width: 0.5, attack: 0.02, release: 0.3, volume: 0.7}
        this.fs2 = sampleRate * 2
        this.lfoPhase = 0
        this.f0Ic1L = 0; this.f0Ic2L = 0; this.f0Ic1R = 0; this.f0Ic2R = 0
        this.f1Ic1L = 0; this.f1Ic2L = 0; this.f1Ic1R = 0; this.f1Ic2R = 0
        this.f2Ic1L = 0; this.f2Ic2L = 0; this.f2Ic1R = 0; this.f2Ic2R = 0
        this.preLp = 0
        this.preRp = 0
        this.decZ1L = 0; this.decZ2L = 0; this.decZ1R = 0; this.decZ2R = 0
        this.tmpFL = [0,0,0]
        this.tmpFR = [0,0,0]
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
        const {detune, attack, release} = this.params
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
            incSub: freq * 0.5 / fs2
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
        const {sub, tone, vowel, morphLFO, morphDepth, formant, drive, width, volume} = this.params
        const fs2 = this.fs2
        const vowels = this.vowels
        const tmpFL = this.tmpFL, tmpFR = this.tmpFR
        const lfoInc = morphLFO / fs2
        const k = Math.max(0.05, 1 / (1 + formant * 11))
        const preGain = 1 + drive * 6
        const toneCoefOS = 1 - Math.sqrt(1 - (0.1 + 0.8 * tone))
        const wLeft = 0.5 + width * 0.5, wRight = 0.5 - width * 0.5
        const {dB0, dB1, dB2, dA1, dA2} = this
        let lfoPhase = this.lfoPhase
        let f0Ic1L = this.f0Ic1L, f0Ic2L = this.f0Ic2L, f0Ic1R = this.f0Ic1R, f0Ic2R = this.f0Ic2R
        let f1Ic1L = this.f1Ic1L, f1Ic2L = this.f1Ic2L, f1Ic1R = this.f1Ic1R, f1Ic2R = this.f1Ic2R
        let f2Ic1L = this.f2Ic1L, f2Ic2L = this.f2Ic2L, f2Ic1R = this.f2Ic1R, f2Ic2R = this.f2Ic2R
        let preLp = this.preLp, preRp = this.preRp
        let decZ1L = this.decZ1L, decZ2L = this.decZ2L, decZ1R = this.decZ1R, decZ2R = this.decZ2R
        for (let s = block.s0; s < block.s1; s++) {
            let decL = 0, decR = 0
            for (let os = 0; os < 2; os++) {
                let dryL = 0, dryR = 0
                for (let v = this.voices.length - 1; v >= 0; v--) {
                    const voice = this.voices[v]
                    const {inc1, inc2, incSub, attackRate, releaseCoef, releasing, level} = voice
                    let env = voice.env
                    if (releasing) env *= releaseCoef
                    else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                    let p1 = voice.p1 + inc1; if (p1 >= 1) p1 -= 1
                    let p2 = voice.p2 + inc2; if (p2 >= 1) p2 -= 1
                    const saw1 = (2 * p1 - 1) - polyBlep(p1, inc1)
                    const saw2 = (2 * p2 - 1) - polyBlep(p2, inc2)
                    const subv = Math.sin(2 * Math.PI * voice.ps)
                    let ps = voice.ps + incSub; if (ps >= 1) ps -= 1
                    const amp = env * level
                    const subAmp = subv * sub * amp
                    dryL += (saw1 * wLeft + saw2 * wRight) * amp + subAmp
                    dryR += (saw1 * wRight + saw2 * wLeft) * amp + subAmp
                    voice.p1 = p1; voice.p2 = p2; voice.ps = ps; voice.env = env
                }
                preLp += toneCoefOS * (dryL - preLp)
                preRp += toneCoefOS * (dryR - preRp)
                const srcL = preLp, srcR = preRp
                const lfoPhaseR = (lfoPhase + width * 0.25) % 1
                let morphPosL = vowel, morphPosR = vowel
                if (morphLFO > 0) {
                    const lfoL = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhase)
                    const lfoR = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhaseR)
                    morphPosL += (lfoL - 0.5) * 2 * morphDepth * 2
                    morphPosR += (lfoR - 0.5) * 2 * morphDepth * 2
                }
                if (morphPosL < 0) morphPosL = 0; else if (morphPosL > 4) morphPosL = 4
                if (morphPosR < 0) morphPosR = 0; else if (morphPosR > 4) morphPosR = 4
                const idxL = morphPosL | 0, fracL = morphPosL - idxL, l0 = idxL >= 4 ? 4 : idxL, l1 = idxL >= 4 ? 4 : idxL + 1
                const idxR = morphPosR | 0, fracR = morphPosR - idxR, r0 = idxR >= 4 ? 4 : idxR, r1 = idxR >= 4 ? 4 : idxR + 1
                for (let m = 0; m < 3; m++) {
                    tmpFL[m] = vowels[l0][m] + (vowels[l1][m] - vowels[l0][m]) * fracL
                    tmpFR[m] = vowels[r0][m] + (vowels[r1][m] - vowels[r0][m]) * fracR
                }
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
                const g0R = Math.tan(Math.PI * tmpFR[0] / fs2), a10R = 1 / (1 + g0R * (g0R + k)), a20R = g0R * a10R
                const v30R = srcR - f0Ic2R, v10R = a10R * f0Ic1R + a20R * v30R, v20R = f0Ic2R + a20R * f0Ic1R + g0R * a20R * v30R
                f0Ic1R = 2 * v10R - f0Ic1R; f0Ic2R = 2 * v20R - f0Ic2R
                const g1R = Math.tan(Math.PI * tmpFR[1] / fs2), a11R = 1 / (1 + g1R * (g1R + k)), a21R = g1R * a11R
                const v31R = srcR - f1Ic2R, v11R = a11R * f1Ic1R + a21R * v31R, v21R = f1Ic2R + a21R * f1Ic1R + g1R * a21R * v31R
                f1Ic1R = 2 * v11R - f1Ic1R; f1Ic2R = 2 * v21R - f1Ic2R
                const g2R = Math.tan(Math.PI * tmpFR[2] / fs2), a12R = 1 / (1 + g2R * (g2R + k)), a22R = g2R * a12R
                const v32R = srcR - f2Ic2R, v12R = a12R * f2Ic1R + a22R * v32R, v22R = f2Ic2R + a22R * f2Ic1R + g2R * a22R * v32R
                f2Ic1R = 2 * v12R - f2Ic1R; f2Ic2R = 2 * v22R - f2Ic2R
                const formantR = v10R + v11R + v12R
                const chL = Math.tanh(formantL * preGain * 0.33)
                const chR = Math.tanh(formantR * preGain * 0.33)
                const yL = dB0 * chL + decZ1L; decZ1L = dB1 * chL - dA1 * yL + decZ2L; decZ2L = dB2 * chL - dA2 * yL
                const yR = dB0 * chR + decZ1R; decZ1R = dB1 * chR - dA1 * yR + decZ2R; decZ2R = dB2 * chR - dA2 * yR
                decL = yL; decR = yR
                if (morphLFO > 0) { lfoPhase += lfoInc; if (lfoPhase >= 1) lfoPhase -= 1 }
            }
            outL[s] += Math.tanh(decL * volume)
            outR[s] += Math.tanh(decR * volume)
        }
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            if (voice.releasing && voice.env < 2e-4) this.voices.splice(v, 1)
        }
        this.lfoPhase = lfoPhase
        this.f0Ic1L = f0Ic1L; this.f0Ic2L = f0Ic2L; this.f0Ic1R = f0Ic1R; this.f0Ic2R = f0Ic2R
        this.f1Ic1L = f1Ic1L; this.f1Ic2L = f1Ic2L; this.f1Ic1R = f1Ic1R; this.f1Ic2R = f1Ic2R
        this.f2Ic1L = f2Ic1L; this.f2Ic2L = f2Ic2L; this.f2Ic1R = f2Ic1R; this.f2Ic2R = f2Ic2R
        this.preLp = preLp; this.preRp = preRp
        this.decZ1L = decZ1L; this.decZ2L = decZ2L; this.decZ1R = decZ1R; this.decZ2R = decZ2R
    }
}