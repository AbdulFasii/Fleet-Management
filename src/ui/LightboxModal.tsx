import { useEffect } from 'react'
import { Modal } from './bits'

export interface LightboxModalProps {
  url: string | null
  title?: string
  onClose: () => void
  /** When given, a Delete button removes the photo (it asks to confirm first). */
  onDelete?: () => void
}

export function LightboxModal({ url, title, onClose, onDelete }: LightboxModalProps) {
  useEffect(() => {
    if (!url) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [url, onClose])

  if (!url) return null

  const isCloud = url.startsWith('http://') || url.startsWith('https://')

  return (
    <Modal onClose={onClose} title={title || 'Full Resolution Image'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', width: '100%' }}>
        <div
          style={{
            maxWidth: '100%',
            maxHeight: '70vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg3)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <img
            src={url}
            alt={title || 'Full view'}
            style={{
              maxWidth: '100%',
              maxHeight: '70vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div className="dim small" style={{ wordBreak: 'break-all' }}>
            {isCloud ? 'Supabase Storage Original' : 'Local Data URL'}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {isCloud && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="button small secondary"
                style={{ textDecoration: 'none' }}
              >
                Open in new tab ↗
              </a>
            )}
            {onDelete && (
              <button
                type="button"
                className="danger small"
                onClick={() => {
                  if (window.confirm('Delete this photo from the gallery?')) onDelete()
                }}
              >
                Delete
              </button>
            )}
            <button type="button" className="small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
