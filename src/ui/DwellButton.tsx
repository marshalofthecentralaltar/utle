import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createDwell, DWELL_MS } from './dwell.ts'
import type { Dwell } from './dwell.ts'

/**
 * A control an eye tracker can hit: at least 96 px square, activated by a click or by resting
 * the pointer on it for DWELL_MS. A fill rises while the pointer rests (section 20.3).
 */
export function DwellButton(props: {
  onActivate(): void
  className: string
  /** The colour of the rising fill, as a Tailwind class. */
  fill: string
  label?: string
  disabled?: boolean
  pressed?: boolean
  data?: Record<string, string>
  children: ReactNode
}) {
  const { onActivate, className, fill, label, disabled, pressed, data, children } = props
  const [dwelling, setDwelling] = useState(false)
  const activate = useRef(onActivate)
  const dwell = useRef<Dwell | null>(null)

  useEffect(() => {
    activate.current = onActivate
  }, [onActivate])

  useEffect(() => {
    const created = createDwell({ onFire: () => activate.current(), onChange: setDwelling })
    dwell.current = created
    return () => created.dispose()
  }, [])

  const dataAttributes = Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]))

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-dwelling={dwelling ? 'true' : 'false'}
      {...dataAttributes}
      onPointerEnter={() => {
        if (!disabled) dwell.current?.enter()
      }}
      onPointerLeave={() => dwell.current?.leave()}
      onClick={() => {
        if (dwell.current?.click() ?? true) onActivate()
      }}
      className={`relative isolate min-h-24 min-w-24 cursor-pointer overflow-hidden ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 -z-10 origin-bottom ${fill}`}
        style={{
          transform: `scaleY(${dwelling ? 1 : 0})`,
          transition: dwelling ? `transform ${DWELL_MS}ms linear` : 'none',
        }}
      />
      {children}
    </button>
  )
}
