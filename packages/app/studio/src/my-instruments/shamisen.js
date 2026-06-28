// @label Shamisen
// @group String orange
// @param decay    1.4  0.2  5.0  exp  s
// @param tone     0.55
// @param sawari   0.4
// @group Pluck yellow
// @param bachi    0.5
// @param hardness 0.6
// @group Performance blue
// @param glide    0.08  0  0.4  lin  s
// @group Output green
// @param volume   0.7

class Processor {
    constructor() {
        this.voices = []
        this.size = 8192
        this.params = {decay: 1.4, tone: 0.55, sawari: 0.4, bachi: 0.5, hardness: 0.6, glide: 0.08, volume: 0.7}
        this.dcX = 0
        this.dcY = 0
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        const {tone, decay, bachi, hardness, glide} = this.params
        const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
        const bright = 0.15 + 0.8 * tone
        const phaseDelay = (1 - bright) / bright + 0.5
        const delay = Math.max(2, Math.min(this.size - 4, sampleRate / freq - phaseDelay))
        const glideCoef = glide > 0 ? 1 - Math.exp(-1 / (glide * sampleRate)) : 1
        if (glide > 0) {
            for (let v = this.voices.length - 1; v >= 0; v--) {
                const live = this.voices[v]
                if (!live.releasing && live.amp * live.env > 0.01) {
                    live.targetDelay = delay
                    live.glideCoef = glideCoef
                    live.bright = bright
                    live.id = id
                    return
                }
            }
        }
        const length = Math.ceil(delay) + 2
        const buffer = new Float32Array(this.size)
        const exciteCut = 0.08 + 0.9 * (0.4 * hardness + 0.6 * velocity)
        let z = 0
        let peak = 1e-9
        for (let i = 0; i < length; i++) {
            z += exciteCut * ((Math.random() * 2 - 1) - z)
            buffer[i] = z
            const abs = Math.abs(z)
            if (abs > peak) peak = abs
        }
        const norm = 0.9 * (0.3 + 0.7 * velocity) / peak
        for (let i = 0; i < length; i++) buffer[i] *= norm
        if (this.voices.length >= 16) this.voices.shift()
        this.voices.push({
            id, buffer, delay, targetDelay: delay, glideCoef, bright, feedback: Math.exp(-6.908 / (decay * freq)),
            writePos: length, lp: 0,
            env: 1, releasing: false, releaseRate: 1, amp: 1,
            clickEnv: bachi * (0.3 + 0.7 * velocity),
            clickDecay: Math.exp(-7 / (0.006 * sampleRate)),
            slapLP: 0, bodyPhase: 0, bodyInc: 2 * Math.PI * 190 / sampleRate
        })
    }
    noteOff(id) {
        for (const voice of this.voices) {
            if (voice.id === id && !voice.releasing) {
                voice.releasing = true
                voice.releaseRate = Math.exp(-7 / (0.18 * sampleRate))
            }
        }
    }
    reset() {
        for (const voice of this.voices) {
            voice.releasing = true
            voice.releaseRate = Math.exp(-7 / (0.005 * sampleRate))
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const {sawari, volume} = this.params
        const size = this.size
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const {buffer, bright, feedback, bodyInc, clickDecay, targetDelay, glideCoef} = voice
            let {writePos, lp, env, amp, clickEnv, slapLP, bodyPhase, delay} = voice
            for (let s = block.s0; s < block.s1; s++) {
                delay += (targetDelay - delay) * glideCoef
                let readPos = writePos - delay
                if (readPos < 0) readPos += size
                const i0 = readPos | 0
                const frac = readPos - i0
                let i1 = i0 + 1
                if (i1 >= size) i1 = 0
                const sample = buffer[i0] + (buffer[i1] - buffer[i0]) * frac
                lp += bright * (sample - lp)
                buffer[writePos] = lp * feedback
                if (++writePos >= size) writePos = 0
                let str = sample
                if (sawari > 0) str = sample + (Math.tanh(sample * (1 + sawari * 8)) - sample) * sawari
                clickEnv *= clickDecay
                slapLP += 0.45 * ((Math.random() * 2 - 1) - slapLP)
                const click = (slapLP * 0.6 + Math.sin(bodyPhase) * 0.5) * clickEnv
                bodyPhase += bodyInc
                if (voice.releasing) env *= voice.releaseRate
                amp += 0.0006 * (Math.abs(str) - amp)
                const mix = (str * env + click) * volume
                outL[s] += mix
                outR[s] += mix
            }
            voice.writePos = writePos; voice.lp = lp; voice.env = env; voice.amp = amp; voice.delay = delay
            voice.clickEnv = clickEnv; voice.slapLP = slapLP; voice.bodyPhase = bodyPhase
            if (amp * env < 2e-4 && clickEnv < 2e-4) this.voices.splice(v, 1)
        }
        let dcX = this.dcX, dcY = this.dcY
        for (let s = block.s0; s < block.s1; s++) {
            const x = outL[s]
            dcY = x - dcX + 0.995 * dcY
            dcX = x
            const y = Math.tanh(dcY)
            outL[s] = y
            outR[s] = y
        }
        this.dcX = dcX; this.dcY = dcY
    }
}
