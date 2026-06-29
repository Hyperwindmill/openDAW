// @label Breakbeat Kit
// @group Kick orange
// @param kickTune   50   30   120  exp Hz
// @param kickDecay  0.18 0.05 0.8  exp s
// @param kickPunch  0.7
// @group Snare red
// @param snareTune  190  120  320  exp Hz
// @param snareDecay 0.18 0.05 0.6  exp s
// @param snap       0.6
// @group Hats yellow
// @param hatDecay   0.05 0.01 0.2  exp s
// @param openDecay  0.3  0.05 1.0  exp s
// @param hatTone    0.6
// @group Drive purple
// @param drive      0.55
// @group Mix green
// @param kickLevel  0.95
// @param snareLevel 0.8
// @param hatLevel   0.5
// @param clapLevel  0.7
// @param volume     0.8

class Processor {
    constructor() {
        this.voices = []
        this.params = {
            kickTune: 50, kickDecay: 0.18, kickPunch: 0.7,
            snareTune: 190, snareDecay: 0.18, snap: 0.6,
            hatDecay: 0.05, openDecay: 0.3, hatTone: 0.6,
            drive: 0.55,
            kickLevel: 0.95, snareLevel: 0.8, hatLevel: 0.5, clapLevel: 0.7, volume: 0.8
        }
    }
    decayCoef(seconds) {
        return Math.exp(-6.908 / (seconds * sampleRate))
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        let type = -1
        if (pitch === 35 || pitch === 36) type = 0
        else if (pitch === 38 || pitch === 40) type = 1
        else if (pitch === 39) type = 4
        else if (pitch === 42 || pitch === 44) type = 2
        else if (pitch === 46) type = 3
        else return
        if (type === 2) {
            for (let v = 0; v < this.voices.length; v++) {
                const live = this.voices[v]
                if (live.type === 3) live.ampCoef = this.decayCoef(0.01)
            }
        }
        if (this.voices.length >= 32) this.voices.shift()
        const params = this.params
        if (type === 0) {
            const kickTune = params.kickTune, kickPunch = params.kickPunch
            this.voices.push({
                id, type, velocity,
                freq: kickTune * (1 + 3 * kickPunch),
                target: kickTune,
                pitchCoef: 1 - Math.exp(-1 / (0.03 * sampleRate)),
                phase: 0,
                env: 1, ampCoef: this.decayCoef(params.kickDecay),
                clickEnv: 1, clickCoef: this.decayCoef(0.001),
                punch: kickPunch
            })
        } else if (type === 1) {
            const snareTune = params.snareTune
            this.voices.push({
                id, type, velocity,
                p1: 0, p2: 0,
                inc1: 2 * Math.PI * snareTune / sampleRate,
                inc2: 2 * Math.PI * snareTune * 1.6 / sampleRate,
                bodyEnv: 1, bodyCoef: this.decayCoef(params.snareDecay * 0.6),
                noiseEnv: 1, noiseCoef: this.decayCoef(params.snareDecay),
                low: 0, band: 0,
                f: 2 * Math.sin(Math.PI * 1800 / sampleRate), q: 0.3
            })
        } else if (type === 2 || type === 3) {
            const seconds = type === 2 ? params.hatDecay : params.openDecay
            this.voices.push({
                id, type, velocity,
                lp1: 0, lp2: 0,
                env: 1, ampCoef: this.decayCoef(seconds)
            })
        } else {
            const burst = Math.floor(0.006 * sampleRate)
            this.voices.push({
                id, type, velocity,
                low: 0, band: 0,
                f: 2 * Math.sin(Math.PI * 1350 / sampleRate), q: 0.4,
                env: 1, burstCoef: this.decayCoef(0.008), tailCoef: this.decayCoef(0.12),
                counter: 0, burstIndex: 0,
                t1: burst, t2: burst * 2, tTail: burst * 3
            })
        }
    }
    noteOff(id) {
    }
    reset() {
        const fast = this.decayCoef(0.005)
        for (let v = 0; v < this.voices.length; v++) {
            const voice = this.voices[v]
            voice.ampCoef = fast
            voice.bodyCoef = fast
            voice.noiseCoef = fast
            voice.burstCoef = fast
            voice.tailCoef = fast
            voice.clickCoef = fast
        }
    }
    process(output, block) {
        const [outL, outR] = output
        const params = this.params
        const snap = params.snap, hatTone = params.hatTone
        const kickLevel = params.kickLevel, snareLevel = params.snareLevel
        const hatLevel = params.hatLevel, clapLevel = params.clapLevel
        const hatCut = 4000 + hatTone * 6000
        const hatCoef = 1 - Math.exp(-2 * Math.PI * hatCut / sampleRate)
        for (let v = this.voices.length - 1; v >= 0; v--) {
            const voice = this.voices[v]
            const type = voice.type, velocity = voice.velocity
            if (type === 0) {
                let freq = voice.freq, phase = voice.phase, env = voice.env, clickEnv = voice.clickEnv
                const target = voice.target, pitchCoef = voice.pitchCoef
                const ampCoef = voice.ampCoef, clickCoef = voice.clickCoef, punch = voice.punch
                const twoPiOverSr = 2 * Math.PI / sampleRate
                for (let s = block.s0; s < block.s1; s++) {
                    freq += (target - freq) * pitchCoef
                    env *= ampCoef
                    clickEnv *= clickCoef
                    const click = (Math.random() * 2 - 1) * clickEnv * punch
                    const out = (Math.sin(phase) * env + click) * velocity * kickLevel
                    phase += twoPiOverSr * freq
                    outL[s] += out
                }
                voice.freq = freq; voice.phase = phase; voice.env = env; voice.clickEnv = clickEnv
                if (env < 2e-4 && clickEnv < 2e-4) this.voices.splice(v, 1)
            } else if (type === 1) {
                let p1 = voice.p1, p2 = voice.p2, bodyEnv = voice.bodyEnv, noiseEnv = voice.noiseEnv
                let low = voice.low, band = voice.band
                const inc1 = voice.inc1, inc2 = voice.inc2, bodyCoef = voice.bodyCoef, noiseCoef = voice.noiseCoef
                const f = voice.f, q = voice.q
                for (let s = block.s0; s < block.s1; s++) {
                    bodyEnv *= bodyCoef
                    noiseEnv *= noiseCoef
                    const bodyOut = (Math.sin(p1) + 0.7 * Math.sin(p2)) * bodyEnv
                    p1 += inc1
                    p2 += inc2
                    const white = Math.random() * 2 - 1
                    low += f * band
                    const high = white - low - q * band
                    band += f * high
                    const noiseBand = band * noiseEnv
                    const out = (bodyOut * (1 - snap) + noiseBand * snap * 1.5) * velocity * snareLevel
                    outL[s] += out
                }
                voice.p1 = p1; voice.p2 = p2; voice.bodyEnv = bodyEnv; voice.noiseEnv = noiseEnv
                voice.low = low; voice.band = band
                if (bodyEnv < 2e-4 && noiseEnv < 2e-4) this.voices.splice(v, 1)
            } else if (type === 2 || type === 3) {
                let lp1 = voice.lp1, lp2 = voice.lp2, env = voice.env
                const ampCoef = voice.ampCoef
                for (let s = block.s0; s < block.s1; s++) {
                    env *= ampCoef
                    const white = Math.random() * 2 - 1
                    lp1 += hatCoef * (white - lp1)
                    const hp1 = white - lp1
                    lp2 += hatCoef * (hp1 - lp2)
                    const hp = hp1 - lp2
                    const out = hp * env * velocity * hatLevel
                    outL[s] += out
                }
                voice.lp1 = lp1; voice.lp2 = lp2; voice.env = env
                if (env < 2e-4) this.voices.splice(v, 1)
            } else {
                let low = voice.low, band = voice.band, env = voice.env
                let counter = voice.counter, burstIndex = voice.burstIndex
                const f = voice.f, q = voice.q
                const burstCoef = voice.burstCoef, tailCoef = voice.tailCoef
                const t1 = voice.t1, t2 = voice.t2, tTail = voice.tTail
                for (let s = block.s0; s < block.s1; s++) {
                    if (burstIndex === 0 && counter >= t1) { env = 1; burstIndex = 1 }
                    else if (burstIndex === 1 && counter >= t2) { env = 1; burstIndex = 2 }
                    else if (burstIndex === 2 && counter >= tTail) { burstIndex = 3 }
                    env *= burstIndex < 3 ? burstCoef : tailCoef
                    counter++
                    const white = Math.random() * 2 - 1
                    low += f * band
                    const high = white - low - q * band
                    band += f * high
                    const out = band * env * velocity * clapLevel
                    outL[s] += out
                }
                voice.low = low; voice.band = band; voice.env = env
                voice.counter = counter; voice.burstIndex = burstIndex
                if (burstIndex === 3 && env < 2e-4) this.voices.splice(v, 1)
            }
        }
        const drive = params.drive, volume = params.volume
        const dr = 1 + drive * 5
        for (let s = block.s0; s < block.s1; s++) {
            const y = Math.tanh(outL[s] * dr) * volume
            outL[s] = y
            outR[s] = y
        }
    }
}
