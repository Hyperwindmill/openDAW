#!/usr/bin/env node
// wav2sampler.mjs — convert a WAV into a base64 SAMPLE block for my-instruments/sampler.js
// Usage: node scripts/wav2sampler.mjs input.wav [--loop startSec endSec]
// Parses PCM (16/24/32-bit int) and 32-bit float WAV, mixes to mono, encodes Int16 base64.
import {readFileSync} from "node:fs"

const argv = process.argv.slice(2)
let input = null, loopStartSec = null, loopEndSec = null
for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--loop") { loopStartSec = parseFloat(argv[++i]); loopEndSec = parseFloat(argv[++i]) }
    else if (!arg.startsWith("--")) input = arg
}
if (!input) {
    console.error("usage: node scripts/wav2sampler.mjs input.wav [--loop startSec endSec]")
    process.exit(1)
}

const buf = readFileSync(input)
if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    console.error("not a RIFF/WAVE file"); process.exit(1)
}
let fmt = null, dataOffset = -1, dataLen = 0
let off = 12
while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === "fmt ") {
        fmt = {
            audioFormat: buf.readUInt16LE(body),
            channels: buf.readUInt16LE(body + 2),
            sampleRate: buf.readUInt32LE(body + 4),
            bitsPerSample: buf.readUInt16LE(body + 14)
        }
    } else if (id === "data") { dataOffset = body; dataLen = size }
    off = body + size + (size & 1)
}
if (!fmt || dataOffset < 0) { console.error("missing fmt/data chunk"); process.exit(1) }

const {audioFormat, channels, sampleRate, bitsPerSample} = fmt
const bytesPerSample = bitsPerSample >> 3
const frameCount = Math.floor(dataLen / (bytesPerSample * channels))
const readSample = (pos) => {
    if (audioFormat === 3 && bitsPerSample === 32) return buf.readFloatLE(pos)
    if (bitsPerSample === 16) return buf.readInt16LE(pos) / 32768
    if (bitsPerSample === 24) {
        let value = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16)
        if (value & 0x800000) value -= 0x1000000
        return value / 8388608
    }
    if (bitsPerSample === 32) return buf.readInt32LE(pos) / 2147483648
    console.error(`unsupported format: audioFormat=${audioFormat} bits=${bitsPerSample}`); process.exit(1)
}

const int16 = Buffer.alloc(frameCount * 2)
for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
        sum += readSample(dataOffset + (frame * channels + channel) * bytesPerSample)
    }
    let value = Math.round((sum / channels) * 32767)
    if (value > 32767) value = 32767; else if (value < -32768) value = -32768
    int16.writeInt16LE(value, frame * 2)
}

const loopStart = loopStartSec != null ? Math.max(0, Math.round(loopStartSec * sampleRate)) : 0
const loopEnd = loopEndSec != null ? Math.min(frameCount, Math.round(loopEndSec * sampleRate)) : frameCount
const b64 = int16.toString("base64")

console.log(`// paste into sampler.js -> SAMPLE`)
console.log(`const SAMPLE = {`)
console.log(`    sampleRate: ${sampleRate},`)
console.log(`    loopStart: ${loopStart},`)
console.log(`    loopEnd: ${loopEnd},`)
console.log(`    data: "${b64}"`)
console.log(`}`)
console.error(`ok: ${frameCount} frames @ ${sampleRate}Hz, ${channels}ch->mono, base64 ${(b64.length / 1024).toFixed(1)}KB`)
