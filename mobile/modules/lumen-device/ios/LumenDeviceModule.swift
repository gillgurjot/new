import ExpoModulesCore
import UIKit
import VideoToolbox

/** iOS: AVPlayer's formats are fixed, so report them directly. */
public class LumenDeviceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LumenDevice")

    Function("capabilities") { () -> [String: Any] in
      var decoders = ["video/avc", "audio/mp4a-latm", "audio/mpeg", "audio/ac3", "audio/eac3", "audio/flac", "audio/opus"]
      if VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC) { decoders.append("video/hevc") }
      let screen = UIScreen.main.nativeBounds
      return [
        "decoders": decoders,
        "maxWidth": Int(max(screen.width, screen.height)),
        "maxHeight": Int(min(screen.width, screen.height)),
        "hdr": UIScreen.main.potentialEDRHeadroom > 1 ? ["hdr10", "hlg", "dovi"] : [],
        "model": UIDevice.current.model,
        "hevcMain10": true,
      ]
    }
  }
}
