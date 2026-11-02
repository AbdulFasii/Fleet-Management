import { useRef, useState } from 'react'

/** Read and compress/downscale uploaded image to keep data URL storage footprint lean across saves. */
export function fileToBrandPicDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('That file is not an image.'))
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.startsWith('data:image/')) {
        reject(new Error('Could not read that image.'))
        return
      }

      // Automatically downscale high-resolution images to fit within 1200x800 for crisp display
      // while reducing file size from megabytes down to ~50-80KB.
      const img = new Image()
      img.onload = () => {
        try {
          const maxDim = 1200
          let { width, height } = img
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(result)
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          const isPng = file.type === 'image/png'
          const compressed = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85)
          resolve(compressed.length < result.length ? compressed : result)
        } catch {
          resolve(result)
        }
      }
      img.onerror = () => resolve(result)
      img.src = result
    }
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

/** Change / Remove controls — can sit in a card header next to other actions. */
export function BrandPicActions({
  value,
  onChange,
  onError,
}: {
  value?: string
  onChange: (pic: string | undefined) => void
  onError?: (msg: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button type="button" className="small" disabled={busy} onClick={() => ref.current?.click()}>
        {value ? 'Change image…' : 'Upload image…'}
      </button>
      {value && (
        <button type="button" className="small" onClick={() => onChange(undefined)}>
          Remove
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setBusy(true)
          fileToBrandPicDataUrl(f)
            .then(onChange)
            .catch((err: Error) => onError?.(err.message))
            .finally(() => setBusy(false))
        }}
      />
    </>
  )
}

export function BrandPicPicker({
  value,
  onChange,
  onError,
  showActions = true,
}: {
  value?: string
  onChange: (pic: string | undefined) => void
  onError?: (msg: string) => void
  /** When false, only the preview is shown (use BrandPicActions elsewhere). */
  showActions?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <div
        style={{
          width: '100%',
          minHeight: 120,
          maxHeight: 280,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
        {value ? (
          <img
            src={value}
            alt="Brand pic"
            style={{ maxWidth: '100%', maxHeight: 280, width: 'auto', height: 'auto', display: 'block' }}
          />
        ) : (
          <span className="dim small">No pic</span>
        )}
      </div>
      {showActions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <BrandPicActions value={value} onChange={onChange} onError={onError} />
      </div>}
    </div>
  )
}
