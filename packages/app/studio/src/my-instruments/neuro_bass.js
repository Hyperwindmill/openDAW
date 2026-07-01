// @label Neuro Bass
// @group FM orange
// @param ratio      2     0.5   8     exp     x
// @param index      4     0     20    linear
// @param indexLFO   4     0.1   16    exp     Hz
// @param indexDepth 0.6
// @param feedback   0.3   0     1     linear
// @group Bands purple
// @param lowCut     300   80    800   exp     Hz
// @param midCut     1800  500   5000  exp     Hz
// @param highCut    5000  2000  12000 exp     Hz
// @param bandGain   1.0   0     3     linear  x
// @group Drive yellow
// @param drive      0.6
// @group Sub green
// @param sub        0.4
// @group Stereo cyan
// @param width      0.5   0     1     linear
// @group Amp green
// @param attack     0.01  0.001 1.0   exp     s
// @param release    0.2   0.01  3.0   exp     s
// @param bite       0.4   0     1     linear
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {ratio: 2, index: 4, indexLFO: 4, indexDepth: 0.6, feedback: 0.3, lowCut: 300, midCut: 1800, highCut: 5000, bandGain: 1.0, drive: 0.6, sub: 0.4, width: 0.5, attack: 0.01, release: 0.2, bite: 0.4, volume: 0.7}
        this.fs2 = sampleRate * 2
        this.indexLfoPhase = 0
        this.lowIc1L = 0; this.lowIc2L = 0; this.lowIc1R = 0; this.lowIc2R = 0
        this.midIc1L = 0; this.midIc2L = 0; this.midIc1R = 0; this.midIc2R = 0
        this.hiIc1L = 0; this.hiIc2L = 0; this.hiIc1R = 0; this.hiIc2R = 0
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
            fb1L: 0, fb2L: 0, fb1R: 0, fb2R: 0, biteEnv: 1
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
        const {ratio, index, indexLFO, indexDepth, feedback, lowCut, midCut, highCut, bandGain, drive, sub, width, bite, volume} = this.params
        const fs2 = this.fs2
        const indexLfoInc = indexLFO / fs2
        const biteCoef = Math.exp(-1 / (0.05 * fs2))
        const distGain = 1 + drive * 5
        const gLow = Math.tan(Math.PI * lowCut / fs2)
        const kLow = Math.max(0.1, 0.8)
        const a1Low = 1 / (1 + gLow * (gLow + kLow)), a2Low = gLow * a1Low, a3Low = gLow * a2Low
        const gMid = Math.tan(Math.PI * midCut / fs2)
        const kMid = Math.max(0.1, 0.9)
        const a1Mid = 1 / (1 + gMid * (gMid + kMid)), a2Mid = gMid * a1Mid, a3Mid = gMid * a2Mid
        const gHi = Math.tan(Math.PI * highCut / fs2)
        const kHi = Math.max(0.1, 0.7)
        const a1Hi = 1 / (1 + gHi * (gHi + kHi)), a2Hi = gHi * a1Hi, a3Hi = gHi * a2Hi
        const {dB0, dB1, dB2, dA1, dA2} = this
        let indexLfoPhase = this.indexLfoPhase
        let lowIc1L = this.lowIc1L, lowIc2L = this.lowIc2L, lowIc1R = this.lowIc1R, lowIc2R = this.lowIc2R
        let midIc1L = this.midIc1L, midIc2L = this.midIc2L, midIc1R = this.midIc1R, midIc2R = this.midIc2R
        let hiIc1L = this.hiIc1L, hiIc2L = this.hiIc2L, hiIc1R = this.hiIc1R, hiIc2R = this.hiIc2R
        let decZ1L = this.decZ1L, decZ2L = this.decZ2L, decZ1R = this.decZ1R, decZ2R = this.decZ2R
        for (let s = block.s0; s < block.s1; s++) {
            let decL = 0, decR = 0
            for (let os = 0; os < 2; os++) {
                const indexLfoPhaseR = (indexLfoPhase + width * 0.25) % 1
                let dryL = 0, dryR = 0
                for (let v = this.voices.length - 1; v >= 0; v--) {
                    const voice = this.voices[v]
                    const {cInc, sInc, carrierFreq, attackRate, releaseCoef, releasing, level} = voice
                    let env = voice.env
                    if (releasing) env *= releaseCoef
                    else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                    let modIndexL = index, modIndexR = index
                    if (indexLFO > 0) {
                        const lfoL = 0.5 - 0.5 * Math.cos(2 * Math.PI * indexLfoPhase)
                        const lfoR = 0.5 - 0.5 * Math.cos(2 * Math.PI * indexLfoPhaseR)
                        modIndexL = index * (1 + (lfoL - 0.5) * 2 * indexDepth)
                        modIndexR = index * (1 + (lfoR - 0.5) * 2 * indexDepth)
                    }
                    const biteMul = 1 + bite * 3 * voice.biteEnv
                    modIndexL *= biteMul; modIndexR *= biteMul
                    voice.biteEnv *= biteCoef
                    const mInc = carrierFreq * ratio / fs2
                    const modulator = Math.sin(2 * Math.PI * voice.mPhase)
                    const fbTermL = feedback * 0.5 * (voice.fb1L + voice.fb2L)
                    const carrierL = Math.sin(2 * Math.PI * (voice.cPhase + modulator * modIndexL + fbTermL))
                    voice.fb2L = voice.fb1L; voice.fb1L = carrierL
                    const fbTermR = feedback * 0.5 * (voice.fb1R + voice.fb2R)
                    const carrierR = Math.sin(2 * Math.PI * (voice.cPhase + modulator * modIndexR + fbTermR))
                    voice.fb2R = voice.fb1R; voice.fb1R = carrierR
                    const subv = Math.sin(2 * Math.PI * voice.sPhase)
                    voice.cPhase += cInc; if (voice.cPhase >= 1) voice.cPhase -= 1
                    voice.mPhase += mInc; if (voice.mPhase >= 1) voice.mPhase -= 1
                    voice.sPhase += sInc; if (voice.sPhase >= 1) voice.sPhase -= 1
                    const amp = env * level
                    const subAmp = subv * sub * amp
                    dryL += carrierL * amp + subAmp
                    dryR += carrierR * amp + subAmp
                    voice.env = env
                }
                const v3lowL = dryL - lowIc2L
                const v1lowL = a1Low * lowIc1L + a2Low * v3lowL
                const v2lowL = lowIc2L + a2Low * lowIc1L + a3Low * v3lowL
                lowIc1L = 2 * v1lowL - lowIc1L; lowIc2L = 2 * v2lowL - lowIc2L
                const lowBandL = v2lowL
                const v3midL = dryL - midIc2L
                const v1midL = a1Mid * midIc1L + a2Mid * v3midL
                const v2midL = midIc2L + a2Mid * midIc1L + a3Mid * v3midL
                midIc1L = 2 * v1midL - midIc1L; midIc2L = 2 * v2midL - midIc2L
                const midBandL = v1midL
                const v3hiL = dryL - hiIc2L
                const v1hiL = a1Hi * hiIc1L + a2Hi * v3hiL
                const v2hiL = hiIc2L + a2Hi * hiIc1L + a3Hi * v3hiL
                hiIc1L = 2 * v1hiL - hiIc1L; hiIc2L = 2 * v2hiL - hiIc2L
                const highBandL = dryL - kHi * v1hiL - v2hiL
                const distSumL = Math.tanh(lowBandL * distGain) + Math.tanh(midBandL * distGain) + Math.tanh(highBandL * distGain)
                const chL = Math.tanh(distSumL * bandGain * 0.4)
                const v3lowR = dryR - lowIc2R
                const v1lowR = a1Low * lowIc1R + a2Low * v3lowR
                const v2lowR = lowIc2R + a2Low * lowIc1R + a3Low * v3lowR
                lowIc1R = 2 * v1lowR - lowIc1R; lowIc2R = 2 * v2lowR - lowIc2R
                const lowBandR = v2lowR
                const v3midR = dryR - midIc2R
                const v1midR = a1Mid * midIc1R + a2Mid * v3midR
                const v2midR = midIc2R + a2Mid * midIc1R + a3Mid * v3midR
                midIc1R = 2 * v1midR - midIc1R; midIc2R = 2 * v2midR - midIc2R
                const midBandR = v1midR
                const v3hiR = dryR - hiIc2R
                const v1hiR = a1Hi * hiIc1R + a2Hi * v3hiR
                const v2hiR = hiIc2R + a2Hi * hiIc1R + a3Hi * v3hiR
                hiIc1R = 2 * v1hiR - hiIc1R; hiIc2R = 2 * v2hiR - hiIc2R
                const highBandR = dryR - kHi * v1hiR - v2hiR
                const distSumR = Math.tanh(lowBandR * distGain) + Math.tanh(midBandR * distGain) + Math.tanh(highBandR * distGain)
                const chR = Math.tanh(distSumR * bandGain * 0.4)
                const yL = dB0 * chL + decZ1L; decZ1L = dB1 * chL - dA1 * yL + decZ2L; decZ2L = dB2 * chL - dA2 * yL
                const yR = dB0 * chR + decZ1R; decZ1R = dB1 * chR - dA1 * yR + decZ2R; decZ2R = dB2 * chR - dA2 * yR
                decL = yL; decR = yR
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
        this.lowIc1L = lowIc1L; this.lowIc2L = lowIc2L; this.lowIc1R = lowIc1R; this.lowIc2R = lowIc2R
        this.midIc1L = midIc1L; this.midIc2L = midIc2L; this.midIc1R = midIc1R; this.midIc2R = midIc2R
        this.hiIc1L = hiIc1L; this.hiIc2L = hiIc2L; this.hiIc1R = hiIc1R; this.hiIc2R = hiIc2R
        this.decZ1L = decZ1L; this.decZ2L = decZ2L; this.decZ1R = decZ1R; this.decZ2R = decZ2R
    }
}