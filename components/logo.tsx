const M_DOTS = [
  { col: 0, row: 0 },{ col: 0, row: 1 },{ col: 0, row: 2 },{ col: 0, row: 3 },{ col: 0, row: 4 },{ col: 0, row: 5 },
  { col: 1, row: 0 },{ col: 1, row: 1 },{ col: 1, row: 2 },
  { col: 2, row: 2 },{ col: 2, row: 3 },{ col: 2, row: 4 },
  { col: 3, row: 1 },
  { col: 4, row: 0 },{ col: 4, row: 1 },{ col: 4, row: 2 },{ col: 4, row: 3 },{ col: 4, row: 4 },{ col: 4, row: 5 },
]

const UNIT = 44, DOT_R = 17, PAD = 20
const W = 4 * UNIT + DOT_R * 2 + PAD * 2
const H = 5 * UNIT + DOT_R * 2 + PAD * 2

export function MLogo({ size = 28, color = 'currentColor', className = '' }: {
  size?: number; color?: string; className?: string
}) {
  return (
    <svg width={size} height={size * (H / W)} viewBox={`0 0 ${W} ${H}`} className={className}>
      {M_DOTS.map((dot, i) => (
        <circle key={i} cx={PAD + DOT_R + dot.col * UNIT} cy={PAD + DOT_R + dot.row * UNIT} r={DOT_R} fill={color} />
      ))}
    </svg>
  )
}
