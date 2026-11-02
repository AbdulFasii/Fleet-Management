import { useRef, useState } from 'react'

/** Store the uploaded image as-is (no resize / recompress). */
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
      resolve(result)
    }
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

export function BrandPicPicker({
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="small" disabled={busy} onClick={() => ref.current?.click()}>
          {value ? 'Change image…' : 'Upload image…'}
        </button>
        {value && (
          <button type="button" className="small" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
      </div>
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
    </div>
  )
}
