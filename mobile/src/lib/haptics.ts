// Light system haptics for controls. Uses the view's haptic feedback, so it
// needs no vibrate permission and follows the phone's own touch-feedback setting.
import { AndroidHaptics, performAndroidHapticsAsync } from 'expo-haptics'

let enabled = true
export const setHapticsEnabled = (on: boolean) => { enabled = on }

function play(type: AndroidHaptics) {
  if (enabled) performAndroidHapticsAsync(type).catch(() => {})
}

export const haptic = {
  toggle: (on: boolean) => play(on ? AndroidHaptics.Toggle_On : AndroidHaptics.Toggle_Off),
  tick: () => play(AndroidHaptics.Clock_Tick),
}
