// @label Impact Boom
// @group Boom orange
// @param tune       50    20    150   exp     Hz
// @param pitchDrop  2.5   0     6     linear  x
// @param decay      0.8   0.1   4.0   exp     s
// @group Noise red
// @param noise      0.5
// @param noiseDecay 0.08  0.01  0.5   exp     s
// @group Drive yellow
// @param drive      0.3
// @group Amp green
// @param volume     0.85

class Processor {
    constructor() {
        this.voices = []
        this.params = {tune: 50, pitchDrop: 2.5, decay: 0.8, noise: 0.5, noiseDecay: 0.08, drive: 0.3, volume: 0.85}
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {tune, pitchDrop, decay, noiseDecay} = this.params
        const freq = tune * Math.pow(2, (pitch - 36) / 12)
        const startFreq = freq * pitchDrop
        if (this.voices.length >= 16) this.voices.shift()
        this.voices.push({
            id, velocity,
            freq: startFreq, targetFreq: freq,
            pitchCoef: 1 - Math.exp(-1 / (0.04 * sampleRate)),
            phase: 0,
            env: 1, ampCoef: Math.exp(-6.908 / (decay * sampleRate)),
            noiseEnv: 1, noiseCoef: Math.exp(-6.908 / (noiseDecay * sampleRate)),
            noiseLp: 0, noiseLp2: 0,
            noiseCut: 1 - Math.exp(-2 * Math.PI * 2000 / sampleRate)
        })
    }
    noteOff(id) {
    }
    reset() {
        const fast = Math.exp(-6.908 / (0.005 * sampleRate))
        for (const voice of this.voices) {
            voice.ampCoef = fast
            voice.noiseCoef = fast
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {noise, drive, volume} = this.params
        const preGain = 1 + drive * 5
        const twoPiOverSr = 2 * Math.PI / sampleRate
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            let {freq, phase, env, noiseEnv, noiseLp, noiseLp2} = voice
            const {targetFreq, pitchCoef, ampCoef, noiseCoef, velocity, noiseCut} = voice
            for (let s = block.s0; s < block.s1; s++) {
                freq += (targetFreq - freq) * pitchCoef
                env *= ampCoef
                noiseEnv *= noiseCoef
                const sine = Math.sin(phase)
                phase += twoPiOverSr * freq
                const white = Math.random() * 2 - 1
                noiseLp += noiseCut * (white - noiseLp)
                noiseLp2 += noiseCut * (noiseLp - noiseLp2)
                const noiseOut = (noiseLp - noiseLp2) * noiseEnv * noise * 2
                const out = (sine * env + noiseOut) * velocity
                outL[s] += out
                outR[s] += out
            }
            voice.freq = freq; voice.phase = phase; voice.env = env; voice.noiseEnv = noiseEnv
            voice.noiseLp = noiseLp; voice.noiseLp2 = noiseLp2
            if (env < 2e-4 && noiseEnv < 2e-4) this.voices.splice(v, 1)
        }
        for (let s = block.s0; s < block.s1; s++) {
            const y = Math.tanh(outL[s] * preGain) * volume
            outL[s] = y
            outR[s] = y
        }
    }
}