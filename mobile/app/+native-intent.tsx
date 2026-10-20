// lumen://auth is where sign-in hands back to the app. The sign-in code reads that link
// itself, so the router just goes home (or to sign-in) instead of looking for a screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(lumen:\/\/)?\/?auth\b/.test(path)) return '/'
    return path
  } catch {
    return '/'
  }
}
