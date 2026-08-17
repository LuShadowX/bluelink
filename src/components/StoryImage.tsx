import { useEffect, useState } from 'react'

interface Props {
  src: string | null
  alt: string
  /** Shown in the fallback plate when there is no usable artwork. */
  letter: string
  eager?: boolean
  sizes?: string
}

/**
 * Publisher artwork is the least reliable thing in the feed: URLs 404, hotlink
 * protection kicks in, and some feeds ship no image at all. Rather than let any
 * of that show as a broken graphic, every failure lands in the same fallback
 * plate, and successful loads fade in so the grid never flashes grey boxes.
 */
export function StoryImage({ src, alt, letter, eager = false, sizes }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // A fresh issue can reuse this component with a different URL.
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  const showFallback = !src || failed

  return (
    <div className="story-image">
      {showFallback ? (
        <div className="story-image__fallback" aria-hidden="true">
          <span>{letter}</span>
        </div>
      ) : (
        <img
          className={`story-image__img${loaded ? ' story-image__img--in' : ''}`}
          src={src}
          alt={alt}
          sizes={sizes}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
          // Several publisher CDNs reject cross-origin requests that carry a
          // referrer they do not recognise.
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
