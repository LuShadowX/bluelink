import type { ReactNode } from 'react'

interface Props {
  label: string
  /** A count, or a link through to the full section. */
  note?: ReactNode
}

/** Label, hairline, count — the divider that separates every block of stories. */
export function SectionRule({ label, note }: Props) {
  return (
    <div className="section-rule">
      <h2 className="section-rule__label">{label}</h2>
      <span className="section-rule__line" aria-hidden="true" />
      {note && <span className="section-rule__note">{note}</span>}
    </div>
  )
}
