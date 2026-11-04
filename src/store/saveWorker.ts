import { compressSync, strToU8 } from 'fflate'

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function compressBody(json: string): { enc: 'raw' | 'zlib-b64'; body: string } {
  try {
    const packed = compressSync(strToU8(json), { level: 3 })
    const b64 = bytesToB64(packed)
    if (b64.length < json.length * 0.92) return { enc: 'zlib-b64', body: b64 }
  } catch { /* fall through */ }
  return { enc: 'raw', body: json }
}

self.onmessage = (e: MessageEvent<{ id: number; dto: Record<string, unknown>; version: number; day: number }>) => {
  const { id, dto, version, day } = e.data
  try {
    const json = JSON.stringify(dto)
    const { enc, body } = compressBody(json)
    const payload = JSON.stringify({
      v: version,
      fmt: 'seatpack',
      enc,
      body,
    })
    self.postMessage({ id, ok: true, payload, day })
  } catch (err: any) {
    self.postMessage({ id, ok: false, error: err?.message || String(err), day })
  }
}
