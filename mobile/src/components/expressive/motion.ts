// Material 3 Expressive motion scheme as Reanimated springs. The spec gives
// damping ratio + stiffness; Reanimated wants absolute damping (ratio·2·√k).
const spring = (ratio: number, stiffness: number) => ({ stiffness, damping: ratio * 2 * Math.sqrt(stiffness), mass: 1 })

export const motion = {
  // Spatial: position, size, scale, shape. Slight overshoot.
  fastSpatial: spring(0.6, 800),
  // Button groups: a touch more bounce; the camera's compact pills far less.
  bouncy: spring(0.5, 700),
  calm: spring(0.85, 700),
  spatial: spring(0.8, 380),
  slowSpatial: spring(0.8, 200),
  // Effects: opacity and colour. No overshoot.
  fastEffects: spring(1, 3800),
  effects: spring(1, 1600),
}

// Shape morph when loading indicator steps between shapes (Compose LoadingIndicator).
export const morphSpring = spring(0.6, 200)
