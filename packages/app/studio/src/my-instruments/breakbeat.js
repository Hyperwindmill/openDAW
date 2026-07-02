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
// @group Stereo cyan
// @param width      0.6   0     1     linear
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
            drive: 0.55, width: 0.6,
            kickLevel: 0.95, snareLevel: 0.8, hatLevel: 0.5, clapLevel: 0.7, volume: 0.8
        }
        this.fs2 = sampleRate * 2
        this.decZ1L = 0; this.decZ2L = 0; this.decZ1R = 0; this.decZ2R = 0
        this.drivePrevL = 0; this.drivePrevR = 0
        const fcDec = sampleRate * 0.45
        const w0 = 2 * Math.PI * fcDec / this.fs2, cosw = Math.cos(w0), sinw = Math.sin(w0), Q = 0.70710678
        const alpha = sinw / (2 * Q), b0 = (1 - cosw) / 2, b1 = 1 - cosw, b2 = (1 - cosw) / 2, a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha
        this.dB0 = b0 / a0; this.dB1 = b1 / a0; this.dB2 = b2 / a0; this.dA1 = a1 / a0; this.dA2 = a2 / a0
    }
    decayCoef(seconds) {
        return Math.exp(-6.908 / (seconds * sampleRate))
    }
    paramChanged(label, value) {
        this.params[label] = value
    }
    noteOn(pitch, velocity, cent, id) {
        let type = -1
        if (pitch === 35 || pitch === 36 || pitch === 48 || pitch === 12) type = 0
        else if (pitch === 38 || pitch === 40 || pitch === 49 || pitch === 88) type = 1
        else if (pitch === 39 || pitch === 11) type = 4
        else if (pitch === 42 || pitch === 44 || pitch === 50 || pitch === 63) type = 2
        else if (pitch === 46 || pitch === 51) type = 3
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
            const g = Math.tan(Math.PI * 1800 / sampleRate), k = 0.3
            const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
            this.voices.push({
                id, type, velocity,
                p1: 0, p2: 0,
                inc1: 2 * Math.PI * snareTune / sampleRate,
                inc2: 2 * Math.PI * snareTune * 1.6 / sampleRate,
                bodyEnv: 1, bodyCoef: this.decayCoef(params.snareDecay * 0.6),
                noiseEnv: 1, noiseCoef: this.decayCoef(params.snareDecay),
                s1L: 0, s2L: 0, s1R: 0, s2R: 0, a1, a2, a3
            })
        } else if (type === 2 || type === 3) {
            const seconds = type === 2 ? params.hatDecay : params.openDecay
            this.voices.push({
                id, type, velocity,
                lp1L: 0, lp2L: 0, lp1R: 0, lp2R: 0,
                env: 1, ampCoef: this.decayCoef(seconds)
            })
        } else {
            const burst = Math.floor(0.006 * sampleRate)
            const g = Math.tan(Math.PI * 1350 / sampleRate), k = 0.4
            const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
            this.voices.push({
                id, type, velocity,
                s1L: 0, s2L: 0, s1R: 0, s2R: 0, a1, a2, a3,
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
                    outR[s] += out
                }
                voice.freq = freq; voice.phase = phase; voice.env = env; voice.clickEnv = clickEnv
                if (env < 2e-4 && clickEnv < 2e-4) this.voices.splice(v, 1)
            } else if (type === 1) {
                let p1 = voice.p1, p2 = voice.p2, bodyEnv = voice.bodyEnv, noiseEnv = voice.noiseEnv
                let s1L = voice.s1L, s2L = voice.s2L, s1R = voice.s1R, s2R = voice.s2R
                const inc1 = voice.inc1, inc2 = voice.inc2, bodyCoef = voice.bodyCoef, noiseCoef = voice.noiseCoef
                const a1 = voice.a1, a2 = voice.a2, a3 = voice.a3
                for (let s = block.s0; s < block.s1; s++) {
                    bodyEnv *= bodyCoef
                    noiseEnv *= noiseCoef
                    const bodyOut = (Math.sin(p1) + 0.7 * Math.sin(p2)) * bodyEnv
                    p1 += inc1
                    p2 += inc2
                    const body = bodyOut * (1 - snap) * velocity * snareLevel
                    const gain = noiseEnv * snap * 1.5 * velocity * snareLevel
                    const wl = Math.random() * 2 - 1
                    const v3L = wl - s2L, v1L = a1 * s1L + a2 * v3L, v2L = s2L + a2 * s1L + a3 * v3L
                    s1L = 2 * v1L - s1L; s2L = 2 * v2L - s2L
                    outL[s] += body + v1L * gain
                    const wr = Math.random() * 2 - 1
                    const v3R = wr - s2R, v1R = a1 * s1R + a2 * v3R, v2R = s2R + a2 * s1R + a3 * v3R
                    s1R = 2 * v1R - s1R; s2R = 2 * v2R - s2R
                    outR[s] += body + v1R * gain
                }
                voice.p1 = p1; voice.p2 = p2; voice.bodyEnv = bodyEnv; voice.noiseEnv = noiseEnv
                voice.s1L = s1L; voice.s2L = s2L; voice.s1R = s1R; voice.s2R = s2R
                if (bodyEnv < 2e-4 && noiseEnv < 2e-4) this.voices.splice(v, 1)
            } else if (type === 2 || type === 3) {
                let lp1L = voice.lp1L, lp2L = voice.lp2L, lp1R = voice.lp1R, lp2R = voice.lp2R, env = voice.env
                const ampCoef = voice.ampCoef
                for (let s = block.s0; s < block.s1; s++) {
                    env *= ampCoef
                    const g = env * velocity * hatLevel
                    const wl = Math.random() * 2 - 1
                    lp1L += hatCoef * (wl - lp1L)
                    const hp1L = wl - lp1L
                    lp2L += hatCoef * (hp1L - lp2L)
                    outL[s] += (hp1L - lp2L) * g
                    const wr = Math.random() * 2 - 1
                    lp1R += hatCoef * (wr - lp1R)
                    const hp1R = wr - lp1R
                    lp2R += hatCoef * (hp1R - lp2R)
                    outR[s] += (hp1R - lp2R) * g
                }
                voice.lp1L = lp1L; voice.lp2L = lp2L; voice.lp1R = lp1R; voice.lp2R = lp2R; voice.env = env
                if (env < 2e-4) this.voices.splice(v, 1)
            } else {
                let s1L = voice.s1L, s2L = voice.s2L, s1R = voice.s1R, s2R = voice.s2R, env = voice.env
                let counter = voice.counter, burstIndex = voice.burstIndex
                const a1 = voice.a1, a2 = voice.a2, a3 = voice.a3
                const burstCoef = voice.burstCoef, tailCoef = voice.tailCoef
                const t1 = voice.t1, t2 = voice.t2, tTail = voice.tTail
                for (let s = block.s0; s < block.s1; s++) {
                    if (burstIndex === 0 && counter >= t1) { env = 1; burstIndex = 1 }
                    else if (burstIndex === 1 && counter >= t2) { env = 1; burstIndex = 2 }
                    else if (burstIndex === 2 && counter >= tTail) { burstIndex = 3 }
                    env *= burstIndex < 3 ? burstCoef : tailCoef
                    counter++
                    const g = env * velocity * clapLevel
                    const wl = Math.random() * 2 - 1
                    const v3L = wl - s2L, v1L = a1 * s1L + a2 * v3L, v2L = s2L + a2 * s1L + a3 * v3L
                    s1L = 2 * v1L - s1L; s2L = 2 * v2L - s2L
                    outL[s] += v1L * g
                    const wr = Math.random() * 2 - 1
                    const v3R = wr - s2R, v1R = a1 * s1R + a2 * v3R, v2R = s2R + a2 * s1R + a3 * v3R
                    s1R = 2 * v1R - s1R; s2R = 2 * v2R - s2R
                    outR[s] += v1R * g
                }
                voice.s1L = s1L; voice.s2L = s2L; voice.s1R = s1R; voice.s2R = s2R; voice.env = env
                voice.counter = counter; voice.burstIndex = burstIndex
                if (burstIndex === 3 && env < 2e-4) this.voices.splice(v, 1)
            }
        }
        const drive = params.drive, volume = params.volume, width = params.width
        const dr = 1 + drive * 5
        const dB0 = this.dB0, dB1 = this.dB1, dB2 = this.dB2, dA1 = this.dA1, dA2 = this.dA2
        let decZ1L = this.decZ1L, decZ2L = this.decZ2L, decZ1R = this.decZ1R, decZ2R = this.decZ2R
        let prevL = this.drivePrevL, prevR = this.drivePrevR
        for (let s = block.s0; s < block.s1; s++) {
            const left = outL[s], right = outR[s]
            const mid = (left + right) * 0.5, side = (left - right) * 0.5
            const inL = mid + side * width, inR = mid - side * width
            let u = Math.tanh((prevL + inL) * 0.5 * dr)
            let yL = dB0 * u + decZ1L; decZ1L = dB1 * u - dA1 * yL + decZ2L; decZ2L = dB2 * u - dA2 * yL
            u = Math.tanh(inL * dr)
            yL = dB0 * u + decZ1L; decZ1L = dB1 * u - dA1 * yL + decZ2L; decZ2L = dB2 * u - dA2 * yL
            outL[s] = yL * volume
            prevL = inL
            u = Math.tanh((prevR + inR) * 0.5 * dr)
            let yR = dB0 * u + decZ1R; decZ1R = dB1 * u - dA1 * yR + decZ2R; decZ2R = dB2 * u - dA2 * yR
            u = Math.tanh(inR * dr)
            yR = dB0 * u + decZ1R; decZ1R = dB1 * u - dA1 * yR + decZ2R; decZ2R = dB2 * u - dA2 * yR
            outR[s] = yR * volume
            prevR = inR
        }
        this.decZ1L = decZ1L; this.decZ2L = decZ2L; this.decZ1R = decZ1R; this.decZ2R = decZ2R
        this.drivePrevL = prevL; this.drivePrevR = prevR
    }
}
