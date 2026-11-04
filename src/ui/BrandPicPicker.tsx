import { useRef, useState } from 'react'
import { isCloudImagesConfigured } from '../lib/supabase'
import { uploadGameImage, deleteImage, type ImageKind } from '../store/cloudImages'
import { LightboxModal } from './LightboxModal'

/** Read and compress/downscale uploaded image — kept as an offline fallback when cloud is unconfigured. */
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

      // Automatically downscale high-resolution images to fit within 800x600 for offline data-URLs
      const img = new Image()
      img.onload = () => {
        try {
          const maxDim = 800
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
          const compressed = canvas.toDataURL('image/jpeg', 0.8)
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

export interface BrandPicActionsProps {
  value?: string
  onChange: (pic: string | undefined) => void
  onError?: (msg: string) => void
  ownerKey?: string
  kind?: ImageKind
  allowOfflineFallback?: boolean
}

/** Change / Remove controls — can sit in a card header next to other actions. */
export function BrandPicActions({
  value,
  onChange,
  onError,
  ownerKey = 'general',
  kind = 'branding',
  allowOfflineFallback = false,
}: BrandPicActionsProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleRemove = async () => {
    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      deleteImage(value).catch((err) => console.warn('Could not delete storage image:', err))
    }
    onChange(undefined)
  }

  return (
    <>
      <button type="button" className="small" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Uploading…' : value ? 'Change image…' : 'Upload image…'}
      </button>
      {value && (
        <button type="button" className="small" disabled={busy} onClick={handleRemove}>
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
          if (!f.type.startsWith('image/')) {
            onError?.('That file is not an image.')
            return
          }

          setBusy(true)

          if (isCloudImagesConfigured()) {
            // High-fidelity cloud upload: preserving original file bytes to Supabase Storage
            uploadGameImage({ file: f, kind, ownerKey, fileName: f.name })
              .then((res) => onChange(res.url))
              .catch((err: Error) => onError?.(err.message || 'Image upload failed.'))
              .finally(() => setBusy(false))
          } else if (allowOfflineFallback) {
            // Offline fallback to compressed data URL
            fileToBrandPicDataUrl(f)
              .then(onChange)
              .catch((err: Error) => onError?.(err.message))
              .finally(() => setBusy(false))
          } else {
            setBusy(false)
            onError?.('Cloud storage not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.')
          }
        }}
      />
    </>
  )
}

export interface BrandPicPickerProps {
  value?: string
  onChange: (pic: string | undefined) => void
  onError?: (msg: string) => void
  /** When false, only the preview is shown (use BrandPicActions elsewhere). */
  showActions?: boolean
  ownerKey?: string
  kind?: ImageKind
  allowOfflineFallback?: boolean
}

export function BrandPicPicker({
  value,
  onChange,
  onError,
  showActions = true,
  ownerKey = 'general',
  kind = 'branding',
  allowOfflineFallback = false,
}: BrandPicPickerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
          overflow: 'hidden',
          position: 'relative',
          cursor: value ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (value) setLightboxOpen(true)
        }}
        title={value ? 'Click to view full resolution image' : undefined}
      >
        {value ? (
          <>
            <img
              src={value}
              alt="Brand or design pic"
              style={{
                maxWidth: '100%',
                maxHeight: 280,
                width: 'auto',
                height: 'auto',
                display: 'block',
                objectFit: 'contain',
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 6,
                right: 6,
                background: 'rgba(0,0,0,0.65)',
                color: '#fff',
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: 4,
                backdropFilter: 'blur(2px)',
                pointerEvents: 'none',
              }}
            >
              Zoom 🔍
            </div>
          </>
        ) : (
          <span className="dim small">No pic</span>
        )}
      </div>

      {showActions && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <BrandPicActions
            value={value}
            onChange={onChange}
            onError={onError}
            ownerKey={ownerKey}
            kind={kind}
            allowOfflineFallback={allowOfflineFallback}
          />
        </div>
      )}

      {lightboxOpen && value && (
        <LightboxModal url={value} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}
