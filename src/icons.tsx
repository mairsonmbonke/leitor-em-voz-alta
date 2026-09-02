import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function svg(path: ReactNode, viewBox = '0 0 24 24') {
  return function Icon({ size = 16, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        {path}
      </svg>
    )
  }
}

export const IconPlay = svg(<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />)
export const IconPause = svg(
  <>
    <rect x="7" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.4" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none" />
  </>,
)
export const IconStop = svg(<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />)
export const IconSpeaker = svg(
  <>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
    <path d="M18 6.7a7.5 7.5 0 0 1 0 10.6" />
  </>,
)
export const IconPencil = svg(
  <>
    <path d="M4 20h4.5L20 8.5a2.12 2.12 0 0 0-3-3L5.5 17z" />
    <path d="M14.5 7 17 9.5" />
  </>,
)
export const IconClipboard = svg(
  <>
    <rect x="8" y="3.5" width="8" height="4" rx="1.4" />
    <path d="M9 5.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2h-2" />
  </>,
)
export const IconUpload = svg(
  <>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </>,
)
export const IconTrash = svg(
  <>
    <path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
  </>,
)
export const IconWand = svg(
  <>
    <path d="M4 20 15 9M13.5 4.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    <path d="M18.5 13.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
  </>,
)
export const IconAlert = svg(
  <>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4.2M12 17.2h.01" />
  </>,
)
export const IconSpinner = svg(
  <>
    <circle cx="12" cy="12" r="9" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </>,
)
