// @label Neuro Bass
// @group FM orange
// @param ratio      2     0.5   8     exp     x
// @param index      4     0     20    linear
// @param indexLFO   4     0.1   16    exp     Hz
// @param indexDepth 0.6
// @group Bands purple
// @param lowCut     300   80    800   exp     Hz
// @param midCut     1800  500   5000  exp     Hz
// @param highCut    5000  2000  12000 exp     Hz
// @param bandGain   1.0   0     3     linear  x
// @group Drive yellow
// @param drive      0.6
// @group Sub green
// @param sub        0.4
// @group Amp green
// @param attack     0.01  0.001 1.0   exp     s
// @param release    0.2   0.01  3.0   exp     s
// @param volume     0.7

class Processor {
    constructor() {
        this.voices = []
        this.params = {ratio: 2, index: 4, indexLFO: 4, indexDepth: 0.6, lowCut: 300, midCut: 1800, highCut: 5000, bandGain: 1.0, drive: 0.6, sub: 0.4, attack: 0.01, release: 0.2, volume: 0.7}
        this.lfoPhase = 0
        this.xLowL = 0; this.xBandL = 0
        this.xLowR = 0; this.xBandR = 0
        this.lpLL = 0; this.lpLR = 0
        this.mLowL = 0; this.mBandL = 0; this.mBandLpL = 0
        this.mLowR = 0; this.mBandR = 0; this.mBandLpR = 0
        this.hLpL = 0; this.hLpR = 0
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
        const {ratio, index, indexLFO, indexDepth, lowCut, midCut, highCut, bandGain, drive, sub, volume} = this.params
        let lfoPhase = this.lfoPhase
        const lfoInc = indexLFO / sampleRate
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
        const xF = 2 * Math.sin(Math.PI * lowCut / sampleRate)
        const xQ = 0.5
        const mF = 2 * Math.sin(Math.PI * midCut / sampleRate)
        const mQ = 1 / (0.5 + 0.3)
        const mBandCoef = 1 - Math.exp(-2 * Math.PI * midCut / sampleRate)
        const hCoef = 1 - Math.exp(-2 * Math.PI * highCut / sampleRate)
        const distGain = 1 + drive * 5
        let xLowL = this.xLowL, xBandL = this.xBandL, xLowR = this.xLowR, xBandR = this.xBandR
        let lpLL = this.lpLL, lpLR = this.lpLR
        let mLowL = this.mLowL, mBandL = this.mBandL, mBandLpL = this.mBandLpL
        let mLowR = this.mLowR, mBandR = this.mBandR, mBandLpR = this.mBandLpR
        let hLpL = this.hLpL, hLpR = this.hLpR
        for (let s = block.s0; s < block.s1; s++) {
            const inL = outL[s], inR = outR[s]
            xLowL += xF * xBandL
            const xHighL = inL - xLowL - xQ * xBandL
            xBandL += xF * xHighL
            if (xBandL > 200) xBandL = 200; else if (xBandL < -200) xBandL = -200
            const lowBandL = xLowL
            const midSrcL = xBandL
            mLowL += mF * mBandL
            const mHighL = midSrcL - mLowL - mQ * mBandL
            mBandL += mF * mHighL
            if (mBandL > 200) mBandL = 200; else if (mBandL < -200) mBandL = -200
            mBandLpL += mBandCoef * (mBandL - mBandLpL)
            const midBandL = mBandLpL
            hLpL += hCoef * (midSrcL - hLpL)
            const highBandL = midSrcL - hLpL
            const distLowL = Math.tanh(lowBandL * distGain)
            const distMidL = Math.tanh(midBandL * distGain)
            const distHighL = Math.tanh(highBandL * distGain)
            xLowR += xF * xBandR
            const xHighR = inR - xLowR - xQ * xBandR
            xBandR += xF * xHighR
            if (xBandR > 200) xBandR = 200; else if (xBandR < -200) xBandR = -200
            const lowBandR = xLowR
            const midSrcR = xBandR
            mLowR += mF * mBandR
            const mHighR = midSrcR - mLowR - mQ * mBandR
            mBandR += mF * mHighR
            if (mBandR > 200) mBandR = 200; else if (mBandR < -200) mBandR = -200
            mBandLpR += mBandCoef * (mBandR - mBandLpR)
            const midBandR = mBandLpR
            hLpR += hCoef * (midSrcR - hLpR)
            const highBandR = midSrcR - hLpR
            const distLowR = Math.tanh(lowBandR * distGain)
            const distMidR = Math.tanh(midBandR * distGain)
            const distHighR = Math.tanh(highBandR * distGain)
            outL[s] = Math.tanh((distLowL + distMidL + distHighL) * bandGain * 0.4) * volume
            outR[s] = Math.tanh((distLowR + distMidR + distHighR) * bandGain * 0.4) * volume
        }
        this.lfoPhase = lfoPhase
        this.xLowL = xLowL; this.xBandL = xBandL; this.xLowR = xLowR; this.xBandR = xBandR
        this.lpLL = lpLL; this.lpLR = lpLR
        this.mLowL = mLowL; this.mBandL = mBandL; this.mBandLpL = mBandLpL
        this.mLowR = mLowR; this.mBandR = mBandR; this.mBandLpR = mBandLpR
        this.hLpL = hLpL; this.hLpR = hLpR
    }
}