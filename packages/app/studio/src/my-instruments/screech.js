// @label Screech
// @group Sync orange
// @param syncRatio   3    1     8     exp     x
// @param syncLFO     0.1  0.1   16    exp     Hz
// @param syncDepth   0.4
// @group Shape purple
// @param shape       0    0     2     int
// @param tone        0.6
// @group Drive yellow
// @param drive       0.7
// @group Amp green
// @param attack      0.005 0.001 0.5  exp     s
// @param release     0.2   0.01  3.0  exp     s
// @param volume      0.6

class Processor {
    constructor() {
        this.voices = []
        this.params = {syncRatio: 3, syncLFO: 0, syncDepth: 0.4, shape: 0, tone: 0.6, drive: 0.7, attack: 0.005, release: 0.2, volume: 0.6}
        this.lfoPhase = 0
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
            masterPhase: 0, slavePhase: 0,
            masterInc: freq / sampleRate
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
        const {syncRatio, syncLFO, syncDepth, shape, tone, drive, volume} = this.params
        let lfoPhase = this.lfoPhase
        const lfoInc = syncLFO / sampleRate
        const sh = shape | 0
        const preGain = 1 + drive * 8
        const toneCoef = 0.05 + 0.9 * tone
        let lpL = this.lpL, lpR = this.lpR
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {masterInc, attackRate, releaseCoef, releasing, level} = voice
            let {masterPhase, slavePhase, env} = voice
            let currentRatio = syncRatio
            if (syncLFO > 0) {
                const lfo = 0.5 - 0.5 * Math.cos(2 * Math.PI * lfoPhase)
                currentRatio = syncRatio * (1 + (lfo - 0.5) * 2 * syncDepth)
                lfoPhase += lfoInc; if (lfoPhase >= 1) lfoPhase -= 1
            }
            const slaveInc = masterInc * currentRatio
            for (let s = block.s0; s < block.s1; s++) {
                if (releasing) env *= releaseCoef
                else if (env < 1) { env += attackRate; if (env > 1) env = 1 }
                masterPhase += masterInc
                if (masterPhase >= 1) {
                    masterPhase -= 1
                    slavePhase = 0
                }
                slavePhase += slaveInc
                if (slavePhase > 1) slavePhase = 1
                let wave
                if (sh === 0) wave = 2 * slavePhase - 1
                else if (sh === 1) wave = Math.sin(2 * Math.PI * slavePhase)
                else wave = slavePhase < 0.5 ? 1 : -1
                const amp = env * level
                outL[s] += wave * amp
                outR[s] += wave * amp
            }
            voice.masterPhase = masterPhase; voice.slavePhase = slavePhase; voice.env = env
            if (releasing && env < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            const shaped = Math.tanh(outL[s] * preGain)
            lpL += toneCoef * (shaped - lpL)
            const shapedR = Math.tanh(outR[s] * preGain)
            lpR += toneCoef * (shapedR - lpR)
            outL[s] = lpL * volume
            outR[s] = lpR * volume
        }
        this.lfoPhase = lfoPhase
        this.lpL = lpL; this.lpR = lpR
    }
}