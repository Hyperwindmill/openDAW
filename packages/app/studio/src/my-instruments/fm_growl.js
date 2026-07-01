// @label FM Growl
// @group FM orange
// @param ratio      2     0.5   8     exp     x
// @param index      3     0     20    linear
// @param indexLFO   0.1   0.1   16    exp     Hz
// @param indexDepth 0.5
// @param feedback   0.3   0     1     linear
// @group Wobble red
// @param wobble     3     0.25  24    exp     Hz
// @param shape      0     0     3     int
// @param depth      0.7
// @group Filter purple
// @param formant    0.5
// @param cutoff     800   100   5000  exp     Hz
// @param reso       0.6
// @group Stereo cyan
// @param width      0.5   0     1     linear
// @group Drive yellow
// @param drive      0.5
// @group Sub green
// @param sub        0.4
// @group Amp green
// @param attack     0.01  0.001 1.0   exp     s
// @param release    0.2   0.01  3.0   exp     s
// @param bite       0.4   0     1     linear
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {ratio: 2, index: 3, indexLFO: 0.1, indexDepth: 0.5, feedback: 0.3, wobble: 3, shape: 0, depth: 0.7, formant: 0.5, cutoff: 800, reso: 0.6, width: 0.5, drive: 0.5, sub: 0.4, attack: 0.01, release: 0.2, bite: 0.4, volume: 0.7}
        this.fs2 = sampleRate * 2
        this.indexLfoPhase = 0
        this.wobblePhase = 0
        this.formIc1L = 0; this.formIc2L = 0; this.formIc1R = 0; this.formIc2R = 0
        this.lpIc1L = 0; this.lpIc2L = 0; this.lpIc1R = 0; this.lpIc2R = 0
        this.decZ1L = 0; this.decZ2L = 0; this.decZ1R = 0; this.decZ2R = 0
        const fcDec = sampleRate * 0.45
        const w0 = 2 * Math.PI * fcDec / this.fs2, cosw = Math.cos(w0), sinw = Math.sin(w0), Q = 0.70710678
        const alpha = sinw / (2 * Q), b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2, a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha
        this.dB0 = b0 / a0; this.dB1 = b1 / a0; this.dB2 = b2 / a0; this.dA1 = a1 / a0; this.dA2 = a2 / a0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {attack, release} = this.params
        const fs2 = this.fs2
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, gate: true, releasing: false, env: 0, level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * fs2),
            releaseCoef: Math.exp(-7 / (release * fs2)),
            cPhase: 0, mPhase: 0, sPhase: 0,
            cInc: freq / fs2,
            sInc: freq * 0.5 / fs2,
            carrierFreq: freq,
            fb1: 0, fb2: 0, biteEnv: 1
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
        const {ratio, index, indexLFO, indexDepth, feedback, wobble, shape, depth, formant, cutoff, reso, width, drive, sub, bite, volume} = this.params
        const fs2 = this.fs2
        const indexLfoInc = indexLFO / fs2
        const wobbleInc = wobble / fs2
        const sh = shape | 0
        const preGain = 1 + drive * 6
        const biteCoef = Math.exp(-1 / (0.05 * fs2))
        const fcForm = 500 + formant * 2500
        const gForm = Math.tan(Math.PI * fcForm / fs2)
        const kForm = Math.max(0.1, 1 / (0.5 + formant * 2))
        const a1Form = 1 / (1 + gForm * (gForm + kForm)), a2Form = gForm * a1Form, a3Form = gForm * a2Form
        const kLp = Math.max(0.05, 1 / (0.7 + reso * 12))
        const {dB0, dB1, dB2, dA1, dA2} = this
        let indexLfoPhase = this.indexLfoPhase
        let wobblePhase = this.wobblePhase
        let formIc1L = this.formIc1L, formIc2L = this.formIc2L, formIc1R = this.formIc1R, formIc2R = this.formIc2R
        let lpIc1L = this.lpIc1L, lpIc2L = this.lpIc2L, lpIc1R = this.lpIc1R, lpIc2R = this.lpIc2R
        let decZ1L = this.decZ1L, decZ2L = this.decZ2L, decZ1R = this.decZ1R, decZ2R = this.decZ2R
        for (let s = block.s0; s < block.s1; s++) {
            let decL = 0, decR = 0
            for (let os = 0; os < 2; os++) {
                let dry = 0
                for (let v = this.voices.length - 1; v >= 0; v--) {
                    const voice = this.voices[v]
                    const {cInc, sInc, carrierFreq, attackRate, releaseCoef, releasing, level} = voice
                    let env = voice.env
                    if (releasing) env *= releaseCoef
                    else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                    let modIndex = index
                    if (indexLFO > 0) {
                        const lfo = 0.5 - 0.5 * Math.cos(2 * Math.PI * indexLfoPhase)
                        modIndex = index * (1 + (lfo - 0.5) * 2 * indexDepth)
                    }
                    modIndex *= (1 + bite * 3 * voice.biteEnv)
                    voice.biteEnv *= biteCoef
                    const mInc = carrierFreq * ratio / fs2
                    const fbTerm = feedback * 0.5 * (voice.fb1 + voice.fb2)
                    const modulator = Math.sin(2 * Math.PI * voice.mPhase) * modIndex
                    const carrier = Math.sin(2 * Math.PI * (voice.cPhase + modulator + fbTerm))
                    voice.fb2 = voice.fb1; voice.fb1 = carrier
                    const subv = Math.sin(2 * Math.PI * voice.sPhase)
                    voice.cPhase += cInc; if (voice.cPhase >= 1) voice.cPhase -= 1
                    voice.mPhase += mInc; if (voice.mPhase >= 1) voice.mPhase -= 1
                    voice.sPhase += sInc; if (voice.sPhase >= 1) voice.sPhase -= 1
                    dry += (carrier + subv * sub) * env * level
                    voice.env = env
                }
                const driven = Math.tanh(dry * preGain)
                const v3formL = driven - formIc2L
                const v1formL = a1Form * formIc1L + a2Form * v3formL
                const v2formL = formIc2L + a2Form * formIc1L + a3Form * v3formL
                formIc1L = 2 * v1formL - formIc1L; formIc2L = 2 * v2formL - formIc2L
                const formantL = v1formL * 2 + v2formL
                const v3formR = driven - formIc2R
                const v1formR = a1Form * formIc1R + a2Form * v3formR
                const v2formR = formIc2R + a2Form * formIc1R + a3Form * v3formR
                formIc1R = 2 * v1formR - formIc1R; formIc2R = 2 * v2formR - formIc2R
                const formantR = v1formR * 2 + v2formR
                let lvL
                if (sh === 0) lvL = 0.5 - 0.5 * Math.cos(2 * Math.PI * wobblePhase)
                else if (sh === 1) lvL = 1 - Math.abs(2 * wobblePhase - 1)
                else if (sh === 2) lvL = 1 - wobblePhase
                else lvL = wobblePhase < 0.5 ? 1 : 0
                let coL = cutoff * Math.exp(depth * lvL * 3)
                if (coL > 6000) coL = 6000; else if (coL < 40) coL = 40
                const gLpL = Math.tan(Math.PI * coL / fs2)
                const a1LpL = 1 / (1 + gLpL * (gLpL + kLp)), a2LpL = gLpL * a1LpL, a3LpL = gLpL * a2LpL
                const v3lpL = formantL - lpIc2L
                const v1lpL = a1LpL * lpIc1L + a2LpL * v3lpL
                const v2lpL = lpIc2L + a2LpL * lpIc1L + a3LpL * v3lpL
                lpIc1L = 2 * v1lpL - lpIc1L; lpIc2L = 2 * v2lpL - lpIc2L
                const chL = v2lpL
                const wobR = (wobblePhase + width * 0.25) % 1
                let lvR
                if (sh === 0) lvR = 0.5 - 0.5 * Math.cos(2 * Math.PI * wobR)
                else if (sh === 1) lvR = 1 - Math.abs(2 * wobR - 1)
                else if (sh === 2) lvR = 1 - wobR
                else lvR = wobR < 0.5 ? 1 : 0
                let coR = cutoff * Math.exp(depth * lvR * 3)
                if (coR > 6000) coR = 6000; else if (coR < 40) coR = 40
                const gLpR = Math.tan(Math.PI * coR / fs2)
                const a1LpR = 1 / (1 + gLpR * (gLpR + kLp)), a2LpR = gLpR * a1LpR, a3LpR = gLpR * a2LpR
                const v3lpR = formantR - lpIc2R
                const v1lpR = a1LpR * lpIc1R + a2LpR * v3lpR
                const v2lpR = lpIc2R + a2LpR * lpIc1R + a3LpR * v3lpR
                lpIc1R = 2 * v1lpR - lpIc1R; lpIc2R = 2 * v2lpR - lpIc2R
                const chR = v2lpR
                const yL = dB0 * chL + decZ1L; decZ1L = dB1 * chL - dA1 * yL + decZ2L; decZ2L = dB2 * chL - dA2 * yL
                const yR = dB0 * chR + decZ1R; decZ1R = dB1 * chR - dA1 * yR + decZ2R; decZ2R = dB2 * chR - dA2 * yR
                decL = yL; decR = yR
                wobblePhase += wobbleInc; if (wobblePhase >= 1) wobblePhase -= 1
                indexLfoPhase += indexLfoInc; if (indexLfoPhase >= 1) indexLfoPhase -= 1
            }
            outL[s] += Math.tanh(decL * volume)
            outR[s] += Math.tanh(decR * volume)
        }
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            if (voice.releasing && voice.env < 2e-4) this.voices.splice(v, 1)
        }
        this.indexLfoPhase = indexLfoPhase
        this.wobblePhase = wobblePhase
        this.formIc1L = formIc1L; this.formIc2L = formIc2L; this.formIc1R = formIc1R; this.formIc2R = formIc2R
        this.lpIc1L = lpIc1L; this.lpIc2L = lpIc2L; this.lpIc1R = lpIc1R; this.lpIc2R = lpIc2R
        this.decZ1L = decZ1L; this.decZ2L = decZ2L; this.decZ1R = decZ1R; this.decZ2R = decZ2R
    }
}