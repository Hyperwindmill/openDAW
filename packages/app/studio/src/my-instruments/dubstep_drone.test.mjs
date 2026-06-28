import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./dubstep_drone.js", import.meta.url), "utf8")
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
const rmsEnvelope = (buf, frame) => {
    const env = []
    for (let i = 0; i + frame <= buf.length; i += frame) {
        let s = 0
        for (let j = 0; j < frame; j++) s += buf[i + j] * buf[i + j]
        env.push(Math.sqrt(s / frame))
    }
    return env
}
// dominant modulation frequency of the RMS envelope via DFT -> Hz
const wobbleRate = (env, frameRate, fmax = 16) => {
    const mean = env.reduce((a, b) => a + b, 0) / env.length
    const e = env.map(x => x - mean)
    const N = e.length, dur = N / frameRate
    let bestHz = 0, best = -Infinity
    for (let k = 1; k / dur <= fmax; k++) {
        let re = 0, im = 0
        for (let n = 0; n < N; n++) { const w = 2 * Math.PI * k * n / N; re += e[n] * Math.cos(w); im -= e[n] * Math.sin(w) }
        const mag = re * re + im * im
        if (mag > best) { best = mag; bestHz = k / dur }
    }
    return bestHz
}
const lowRatio = (buf, atSec, sr, cutHz = 250) => {
    const N = 2048, start = Math.floor(atSec * sr), maxK = 400
    let lo = 0, total = 0
    for (let k = 1; k <= maxK; k++) {
        const w = 2 * Math.PI * k / N
        let re = 0, im = 0
        for (let n = 0; n < N; n++) {
            const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1))
            const val = buf[start + n] * win
            re += val * Math.cos(w * n); im -= val * Math.sin(w * n)
        }
        const mag = Math.sqrt(re * re + im * im)
        total += mag
        if (k * sr / N < cutHz) lo += mag
    }
    return total > 0 ? lo / total : 0
}
const near = (a, b, tol) => Math.abs(a - b) / b < tol

let fail = 0
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${extra}`); if (!cond) fail++ }

// 1) Sustained note: finite, bounded, audible
{
    const p = new Processor()
    const r = record(p, 1.0, [{at: 0, fn: pr => pr.noteOn(33, 0.9, 0, 1)}])
    check("finite", !r.anyNaN)
    check("bounded (<=1)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("audible", r.peak > 0.1, `peak=${r.peak.toFixed(3)}`)
}
// 2) noteOff releases and culls
{
    const p = new Processor()
    const r = record(p, 1.5, [
        {at: 0, fn: pr => pr.noteOn(33, 0.9, 0, 1)},
        {at: sampleRate * 0.5 | 0, fn: pr => pr.noteOff(1)}
    ])
    check("releases & culls", p.voices.length === 0, `left=${p.voices.length}`)
    check("release finite/bounded", !r.anyNaN && r.peak <= 1.0)
}
// 3) Strong sub/low end present (isolated: wobble + drive off)
{
    const p = new Processor()
    p.paramChanged("depth", 0)
    p.paramChanged("drive", 0)
    p.paramChanged("cutoff", 120)
    const r = record(p, 1.0, [{at: 0, fn: pr => pr.noteOn(33, 0.95, 0, 1)}])
    const lr = lowRatio(r.out, 0.5, sampleRate)
    check("strong low end (<250Hz >= 55%)", lr >= 0.55, `lowRatio=${(lr * 100).toFixed(1)}%`)
}
// 4) Wobble actually modulates at the set rate (4Hz and 8Hz)
{
    const frame = 256, frameRate = sampleRate / frame
    for (const rate of [4, 8]) {
        const p = new Processor()
        p.paramChanged("detune", 0)
        p.paramChanged("reso", 0)
        p.paramChanged("wobble", rate)
        const r = record(p, 1.5, [{at: 0, fn: pr => pr.noteOn(69, 0.9, 0, 1)}])
        const env = rmsEnvelope(r.out, frame)
        const steady = env.slice(Math.floor(env.length * 0.25))
        const mx = Math.max(...steady), mn = Math.min(...steady)
        const depth = (mx - mn) / mx
        const detected = wobbleRate(env.slice(Math.floor(env.length * 0.2)), frameRate)
        check(`wobble ${rate}Hz: modulates`, depth > 0.15, `depth=${(depth * 100).toFixed(0)}%`)
        check(`wobble ${rate}Hz: detected rate ~${rate}Hz`, near(detected, rate, 0.2), `detected=${detected.toFixed(1)}Hz`)
    }
}
// 5) Poly (chord) + reset
{
    const p = new Processor()
    const r = record(p, 0.6, [
        {at: 0, fn: pr => pr.noteOn(33, 0.8, 0, 1)},
        {at: 0, fn: pr => pr.noteOn(40, 0.8, 0, 2)},
        {at: 0, fn: pr => pr.noteOn(45, 0.8, 0, 3)},
        {at: sampleRate * 0.3 | 0, fn: pr => pr.reset()}
    ])
    check("chord max voices == 3", r.maxVoices === 3, `maxVoices=${r.maxVoices}`)
    check("reset culls all", p.voices.length === 0, `left=${p.voices.length}`)
    check("chord finite/bounded", !r.anyNaN && r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)
