import {readFileSync} from "fs"

const sampleRate = 48000
const src = readFileSync(new URL("./braam.js", import.meta.url), "utf8")
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

// 1) Sustained note: finite, bounded, audible
{
    const p = new Processor()
    const r = record(p, 2.0, [{at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)}])
    check("finite", !r.anyNaN)
    check("bounded (<=1)", r.peak <= 1.0, `peak=${r.peak.toFixed(3)}`)
    check("audible", r.peak > 0.05, `peak=${r.peak.toFixed(3)}`)
}
// 2) Slow attack: amplitude rises gradually
{
    const p = new Processor()
    p.paramChanged("attack", 0.3)
    const r = record(p, 1.0, [{at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)}])
    const firstQuarter = (() => { let e = 0; const n = Math.floor(0.1 * sampleRate); for (let i = 0; i < n; i++) e += r.out[i] * r.out[i]; return e })()
    const lastQuarter = (() => { let e = 0; const start = Math.floor(0.4 * sampleRate); for (let i = start; i < start + Math.floor(0.1 * sampleRate); i++) e += r.out[i] * r.out[i]; return e })()
    check("slow attack rises", lastQuarter > firstQuarter * 2,
        `early=${firstQuarter.toExponential(2)} late=${lastQuarter.toExponential(2)}`)
}
// 3) noteOff releases and culls
{
    const p = new Processor()
    const r = record(p, 4.0, [
        {at: 0, fn: pr => pr.noteOn(36, 0.9, 0, 1)},
        {at: sampleRate * 1.0 | 0, fn: pr => pr.noteOff(1)}
    ])
    check("releases & culls", p.voices.length === 0, `left=${p.voices.length}`)
    check("release finite/bounded", !r.anyNaN && r.peak <= 1.0)
}
// 4) Poly + reset
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