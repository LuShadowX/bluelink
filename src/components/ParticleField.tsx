import { useEffect, useRef } from 'react'

/**
 * The background: a drifting constellation of particles, linked to each other
 * and to the cursor.
 *
 * This is a deliberate port of the field on the author's portfolio
 * (lushadowx.github.io/Portfolio), down to the colours, counts, speeds and radii
 * — the two sites are meant to read as the same hand. What is not ported is the
 * cumulative `ctx.scale(dpr, dpr)` on every resize, which compounds the
 * transform each time the window changes size; this uses setTransform so a
 * resize is idempotent.
 *
 * Everything here is decorative and inert: the canvas never takes pointer
 * events, so a card underneath is always clickable.
 */

const CONFIG = {
  /** Electric blue dots. */
  particleColor: 'rgba(40, 170, 255, 1)',
  /** Neon purple links, as `r, g, b` so the alpha can vary per line. */
  lineColor: '160, 50, 240',
  startAmount: 100,
  maxParticles: 220,
  /** One new particle every this many milliseconds, until the cap. */
  autoSpawnMs: 80,
  defaultSpeed: 0.5,
  variantSpeed: 0.8,
  linkRadius: 150,
  mouseRadius: 200,
  /** Particles added where the reader clicks. */
  burst: 5,
}

/**
 * The link pass is O(n²), so the cap has to answer to the size of the window
 * rather than being a constant: 220 particles is right for a desktop and far too
 * many for a phone, where it would cost frames without being any more visible.
 */
function capFor(width: number, height: number): number {
  const byArea = Math.round((width * height) / 8200)
  return Math.max(46, Math.min(CONFIG.maxParticles, byArea))
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let cap = CONFIG.maxParticles
    let particles: Particle[] = []
    const mouse: { x: number | null; y: number | null } = { x: null, y: null }
    let frame = 0
    let spawnTimer = 0

    const spawn = (x?: number, y?: number): Particle => ({
      x: x ?? Math.random() * width,
      y: y ?? Math.random() * height,
      vx: (Math.random() - 0.5) * CONFIG.variantSpeed + CONFIG.defaultSpeed * 0.5,
      vy: (Math.random() - 0.5) * CONFIG.variantSpeed + CONFIG.defaultSpeed * 0.5,
      size: Math.random() * 2 + 0.5,
      // Fading in means a spawning particle never pops into existence.
      opacity: 0,
    })

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      // setTransform, not scale: scale multiplies whatever is already there, so
      // resizing twice would draw at 4x.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      cap = capFor(width, height)
      if (particles.length > cap) particles.length = cap
    }

    resize()
    particles = Array.from({ length: Math.min(CONFIG.startAmount, cap) }, () => spawn())

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]!

        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
        if (p.opacity < 1) p.opacity += 0.02

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.globalAlpha = p.opacity
        ctx.fillStyle = CONFIG.particleColor
        ctx.fill()
        ctx.globalAlpha = 1

        // Links to the particles after this one, so each pair is drawn once.
        for (let j = i + 1; j < particles.length; j += 1) {
          const other = particles[j]!
          const dx = p.x - other.x
          const dy = p.y - other.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance >= CONFIG.linkRadius) continue

          const alpha = (1 - distance / CONFIG.linkRadius) * p.opacity * other.opacity
          ctx.beginPath()
          ctx.strokeStyle = `rgba(${CONFIG.lineColor}, ${alpha})`
          ctx.lineWidth = 0.4
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(other.x, other.y)
          ctx.stroke()
        }

        if (mouse.x != null && mouse.y != null) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance < CONFIG.mouseRadius) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(${CONFIG.lineColor}, ${1 - distance / CONFIG.mouseRadius})`
            ctx.lineWidth = 0.6
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(mouse.x, mouse.y)
            ctx.stroke()
          }
        }
      }
    }

    const tick = (now: number) => {
      if (now - spawnTimer > CONFIG.autoSpawnMs) {
        spawnTimer = now
        if (particles.length < cap) particles.push(spawn())
      }
      draw()
      frame = window.requestAnimationFrame(tick)
    }

    if (reduced) {
      // One still frame: the constellation without the drift.
      for (const p of particles) p.opacity = 1
      draw()
    } else {
      frame = window.requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      mouse.x = event.clientX
      mouse.y = event.clientY
    }
    const onLeave = () => {
      mouse.x = null
      mouse.y = null
    }
    const onClick = (event: PointerEvent) => {
      if (particles.length > cap + CONFIG.burst * 4) return
      for (let i = 0; i < CONFIG.burst; i += 1) {
        particles.push(spawn(event.clientX, event.clientY))
      }
    }
    /** A hidden tab should not be animating; a returning one should not jump. */
    const onVisibility = () => {
      window.cancelAnimationFrame(frame)
      if (document.visibilityState === 'visible' && !reduced) {
        spawnTimer = performance.now()
        frame = window.requestAnimationFrame(tick)
      }
    }

    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerout', onLeave)
    window.addEventListener('pointerdown', onClick)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerout', onLeave)
      window.removeEventListener('pointerdown', onClick)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <>
      <canvas className="pfield" ref={canvasRef} aria-hidden="true" />
      {/* Film grain and scanlines, both carried over from the portfolio. They sit
          above the content at a couple of percent opacity — enough to give the
          page a surface, not enough to be seen looking for it. */}
      <div className="pgrain" aria-hidden="true" />
      <div className="pscan" aria-hidden="true" />
    </>
  )
}
