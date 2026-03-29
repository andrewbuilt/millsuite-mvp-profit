import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const M_DOTS = [
  { col: 0, row: 0 },{ col: 0, row: 1 },{ col: 0, row: 2 },{ col: 0, row: 3 },{ col: 0, row: 4 },{ col: 0, row: 5 },
  { col: 1, row: 0 },{ col: 1, row: 1 },{ col: 1, row: 2 },
  { col: 2, row: 2 },{ col: 2, row: 3 },{ col: 2, row: 4 },
  { col: 3, row: 1 },
  { col: 4, row: 0 },{ col: 4, row: 1 },{ col: 4, row: 2 },{ col: 4, row: 3 },{ col: 4, row: 4 },{ col: 4, row: 5 },
]

const UNIT = 19
const DOT_SIZE = 15
const PAD = 34

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#111111',
        }}
      >
        <div style={{ position: 'relative', display: 'flex', width: 4 * UNIT + DOT_SIZE, height: 5 * UNIT + DOT_SIZE }}>
          {M_DOTS.map((dot, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: dot.col * UNIT,
                top: dot.row * UNIT,
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: '50%',
                backgroundColor: 'white',
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size }
  )
}
