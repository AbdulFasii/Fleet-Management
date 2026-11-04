/**
 * Client for the background save encoder Web Worker.
 * Offloads JSON.stringify + zlib compression + base64 off the main UI thread.
 */
import { encodeSaveStringFromDto } from './saveCodec'

interface PendingRequest {
  resolve: (payload: string) => void
  reject: (err: any) => void
}

let workerInstance: Worker | null = null
let workerFailed = false
let reqSeq = 1
const pendingRequests = new Map<number, PendingRequest>()

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null

  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./saveWorker.ts', import.meta.url), {
        type: 'module',
      })

      workerInstance.onmessage = (e: MessageEvent<{ id: number; ok: boolean; payload?: string; error?: string }>) => {
        const { id, ok, payload, error } = e.data
        const req = pendingRequests.get(id)
        if (!req) return
        pendingRequests.delete(id)
        if (ok && payload) {
          req.resolve(payload)
        } else {
          req.reject(new Error(error || 'Worker encode failed'))
        }
      }

      workerInstance.onerror = (err) => {
        console.warn('Save worker error, falling back to sync encoder:', err)
        workerFailed = true
        // Reject all pending and clear
        for (const req of pendingRequests.values()) {
          req.reject(err)
        }
        pendingRequests.clear()
        try {
          workerInstance?.terminate()
        } catch {}
        workerInstance = null
      }
    } catch (err) {
      console.warn('Could not initialize save worker:', err)
      workerFailed = true
      return null
    }
  }

  return workerInstance
}

/**
 * Encode a save DTO to string asynchronously using the Web Worker.
 * Falls back to synchronous encoding on the main thread if worker is unavailable.
 */
export async function encodeSaveDtoAsync(
  dto: Record<string, unknown>,
  version: number,
  day: number,
): Promise<string> {
  const worker = getWorker()
  if (!worker) {
    return encodeSaveStringFromDto(dto, version)
  }

  const id = reqSeq++
  return new Promise<string>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })
    try {
      worker.postMessage({ id, dto, version, day })
    } catch (err) {
      pendingRequests.delete(id)
      console.warn('Worker postMessage failed, using sync fallback:', err)
      resolve(encodeSaveStringFromDto(dto, version))
    }
  })
}
