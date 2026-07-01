import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./riser.js", import.meta.url), "utf8")
const Processor = new Function("sampleRate", src + "\n; return Processor")(sampleRate)

const BLOCK = 128
const record = (proc, seconds, events) => {
    const total = Math.floor(seconds * sampleRate)
    const out = new Float32Array(total)
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK)
    let pos = 0, maxVoices = 0, anyNaN = false, peak = 0
    while (pos < total) {
        outL.fill(0); outR.fill(0)
        for (const ev of events) if (ev.at >= pos && ev.at < pos + BLOCK) ev.fn(proc)
        proc.process([outL, outR], {s0: 0, s1: BLOCK, index: pos / BLOCK, bpm: 140, p0: 0, p1: 0, flags: 5})
        for (let i = 0; i < BLOCK && pos + i < total; i++) {
            const l = outL[i]
            if (!Number.isFinite(l)) anyNaN = true
            const a = Math.abs(l); if (a > peak) peak = a
            out[pos + i] = l
        }
        maxVoices = Math.max(maxVoices, proc.voices.length)
        pos += BLOCK
    }
    return {out, maxVoices, anyNaN, peak}
}

let fail = 0
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${extra}`); if (!cond) fail++ }

// 1) One-shot: finite, bounded, audible, self-culls
{
    const p = new Processor()
    const r = record(p, 4.0, [{at: 0, fn: pr => pr.noteOn(60, 0.9, 0, 1)}])
    check("finite", !r.anyNaN)
    check("bounded (<=1)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("audible", r.peak > 0.02, `peak=${r.peak.toFixed(3)}`)
    check("self-culls", p.voices.length === 0, `left=${p.voices.length}`)
}
// 2) Spectral content rises over time (high-freq energy grows)
{
    const p = new Processor()
    p.paramChanged("sweepTime", 0.5)
    p.paramChanged("release", 1.5)
    const r = record(p, 1.0, [{at: 0, fn: pr => pr.noteOn(60, 0.9, 0, 1)}])
    const N = 512
    const winF = (start) => {
        let hi = 0, lo = 0
        for (let k = 1; k <= 100; k++) {
            const w = 2 * Math.PI * k / N
            let re = 0, im = 0
            for (let n = 0; n < N; n++) {
                const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1))
                const val = r.out[start + n] * win
                re += val * Math.cos(w * n); im -= val * Math.sin(w * n)
            }
            const mag = Math.sqrt(re * re + im * im)
            if (k * sampleRate / N < 2000) lo += mag; else hi += mag
        }
        return hi / Math.max(hi + lo, 1e-30)
    }
    const earlyRatio = winF(Math.floor(0.05 * sampleRate))
    const lateRatio = winF(Math.floor(0.4 * sampleRate))
    check("spectral content rises", lateRatio > earlyRatio,
        `early=${(earlyRatio * 100).toFixed(0)}% late=${(lateRatio * 100).toFixed(0)}%`)
}
// 3) Envelope rises with sweep (amplitude grows over time)
{
    const frame = 1024
    const p = new Processor()
    p.paramChanged("sweepTime", 1.5)
    p.paramChanged("release", 0.5)
    const r = record(p, 1.2, [{at: 0, fn: pr => pr.noteOn(60, 0.9, 0, 1)}])
    const env = []
    for (let i = 0; i + frame <= r.out.length; i += frame) {
        let s = 0
        for (let j = 0; j < frame; j++) s += r.out[i + j] * r.out[i + j]
        env.push(Math.sqrt(s / frame))
    }
    const early = env[2]
    const mid = env[Math.floor(env.length * 0.5)]
    const late = env[Math.floor(env.length * 0.7)]
    check("amplitude rises (mid > early)", mid > early, `early=${early.toExponential(2)} mid=${mid.toExponential(2)}`)
    check("amplitude rises (late > early)", late > early, `early=${early.toExponential(2)} late=${late.toExponential(2)}`)
}
// 4) reset fast-releases
{
    const p = new Processor()
    const r = record(p, 1.0, [
        {at: 0, fn: pr => pr.noteOn(60, 0.9, 0, 1)},
        {at: sampleRate * 0.1 | 0, fn: pr => pr.reset()}
    ])
    check("reset culls", p.voices.length === 0, `left=${p.voices.length}`)
    check("reset finite", !r.anyNaN)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)