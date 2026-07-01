// @label FM Growl
// @group FM orange
// @param ratio      2     0.5   8     exp     x
// @param index      3     0     20    linear
// @param indexLFO   0     0     16    exp     Hz
// @param indexDepth 0.5
// @group Filter purple
// @param formant    0.5
// @param cutoff     800   100   5000  exp     Hz
// @group Drive yellow
// @param drive      0.5
// @group Sub green
// @param sub        0.4
// @group Amp green
// @param attack     0.01  0.001 1.0   exp     s
// @param release    0.2   0.01  3.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {ratio: 2, index: 3, indexLFO: 0, indexDepth: 0.5, formant: 0.5, cutoff: 800, drive: 0.5, sub: 0.4, attack: 0.01, release: 0.2, volume: 0.7}
        this.lfoPhase = 0
        this.bpLowL = 0; this.bpBandL = 0
        this.bpLowR = 0; this.bpBandR = 0
        this.lpL = 0; this.lpR = 0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {attack, release} = this.params
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        if (this.voices.length >= 8) this.voices.shift()
        this.voices.push({
            id, gate: true, releasing: false, env: 0, level: 0.3 + 0.7 * velocity,
            attackRate: 1 / Math.max(1, attack * sampleRate),
            releaseCoef: Math.exp(-7 / (release * sampleRate)),
            cPhase: 0, mPhase: 0, sPhase: 0,
            cInc: freq / sampleRate,
            mInc: 0,
            sInc: freq * 0.5 / sampleRate,
            carrierFreq: freq
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
        const {ratio, index, indexLFO, indexDepth, formant, cutoff, drive, sub, volume} = this.params
        let lfoPhase = this.lfoPhase
        const lfoInc = indexLFO / sampleRate
        const bpF = 2 * Math.sin(Math.PI * (500 + formant * 2500) / sampleRate)
        const bpQ = 1 / (0.5 + formant * 2)
        const lpCoef = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate)
        const preGain = 1 + drive * 6
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {cInc, sInc, carrierFreq, attackRate, releaseCoef, releasing, level} = voice
            let {cPhase, mPhase, sPhase, env} = voice
            const mInc = carrierFreq * ratio / sampleRate
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                let modIndex = index
                if (indexLFO > 0) {
                    const lfo = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhase)
                    modIndex = index * (1 + (lfo - 0.5) * 2 * indexDepth)
                    lfoPhase += lfoInc; if (lfoPhase >= 1) lfoPhase -= 1
                }
                const modulator = Math.sin(2 * Math.PI * mPhase) * modIndex
                const carrier = Math.sin(2 * Math.PI * (cPhase + modulator))
                cPhase += cInc; if (cPhase >= 1) cPhase -= 1
                mPhase += mInc; if (mPhase >= 1) mPhase -= 1
                const subv = Math.sin(2 * Math.PI * sPhase)
                sPhase += sInc; if (sPhase >= 1) sPhase -= 1
                const amp = env * level
                outL[s] += (carrier + subv * sub) * amp
                outR[s] += (carrier + subv * sub) * amp
            }
            voice.cPhase = cPhase; voice.mPhase = mPhase; voice.sPhase = sPhase; voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        let bpLowL = this.bpLowL, bpBandL = this.bpBandL, bpLowR = this.bpLowR, bpBandR = this.bpBandR
        let lpL = this.lpL, lpR = this.lpR
        for (let s = block.s0; s < block.s1; s++) {
            const driven = Math.tanh(outL[s] * preGain)
            bpLowL += bpF * bpBandL
            const highL = driven - bpLowL - bpQ * bpBandL
            bpBandL += bpF * highL
            if (bpBandL > 200) bpBandL = 200; else if (bpBandL < -200) bpBandL = -200
            lpL += lpCoef * ((bpLowL + bpBandL * 2) - lpL)
            const drivenR = Math.tanh(outR[s] * preGain)
            bpLowR += bpF * bpBandR
            const highR = drivenR - bpLowR - bpQ * bpBandR
            bpBandR += bpF * highR
            if (bpBandR > 200) bpBandR = 200; else if (bpBandR < -200) bpBandR = -200
            lpR += lpCoef * ((bpLowR + bpBandR * 2) - lpR)
            outL[s] = Math.tanh(lpL * volume)
            outR[s] = Math.tanh(lpR * volume)
        }
        this.lfoPhase = lfoPhase
        this.bpLowL = bpLowL; this.bpBandL = bpBandL; this.bpLowR = bpLowR; this.bpBandR = bpBandR
        this.lpL = lpL; this.lpR = lpR
    }
}