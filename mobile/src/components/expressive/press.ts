import { useCallback, useRef } from 'react'
import { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated'
import { motion } from './motion'

// 0 → 1 while a finger is down. Like Compose's expressive buttons, a quick tap
// still plays most of the press before springing back, so it always reads.
export function usePressValue() {
  const p = useSharedValue(0)
  const at = useRef(0)
  const onPressIn = useCallback(() => {
    at.current = Date.now()
    p.set(withSpring(1, motion.fastSpatial))
  }, [p])
  const onPressOut = useCallback(() => {
    const wait = Math.max(0, 70 - (Date.now() - at.current))
    p.set(withDelay(wait, withSpring(0, motion.fastSpatial)))
  }, [p])
  return { p, onPressIn, onPressOut }
}

// Cards and tiles sink a little under the finger and bounce back on release.
export function usePressScale(amount = 0.04) {
  const { p, onPressIn, onPressOut } = usePressValue()
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - amount * p.value }] }))
  return { style, onPressIn, onPressOut }
}
