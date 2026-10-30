import { requireOptionalNativeModule } from 'expo'

export interface Capabilities {
  /** Decoder MIME types, e.g. video/hevc, audio/eac3. */
  decoders: string[]
  maxWidth: number
  maxHeight: number
  hdr: string[]
  /** The HEVC decoder handles 10-bit video. */
  hevcMain10?: boolean
  model: string
}

const native = requireOptionalNativeModule<{ capabilities(): Capabilities }>('LumenDevice')

export function capabilities(): Capabilities | null {
  try {
    return native?.capabilities() ?? null
  } catch {
    return null
  }
}
