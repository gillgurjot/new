package expo.modules.lumendevice

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Tells the app what this phone can decode, so the server only converts what it must. */
class LumenDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LumenDevice")

    Function("capabilities") {
      val decoders = mutableSetOf<String>()
      var maxWidth = 0
      var maxHeight = 0
      var hevcMain10 = false
      for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
        if (info.isEncoder) continue
        for (type in info.supportedTypes) {
          val mime = type.lowercase()
          decoders.add(mime)
          if (mime == "video/avc" || mime == "video/hevc") {
            try {
              val v = info.getCapabilitiesForType(type).videoCapabilities
              if (v != null) {
                maxWidth = maxOf(maxWidth, v.supportedWidths.upper)
                maxHeight = maxOf(maxHeight, v.supportedHeights.upper)
              }
              // Most HEVC films are 10-bit; some decoders only do 8-bit.
              if (mime == "video/hevc" && info.getCapabilitiesForType(type).profileLevels.any { it.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 }) {
                hevcMain10 = true
              }
            } catch (_: Exception) {}
          }
        }
      }
      val hdr = mutableListOf<String>()
      val ctx = appContext.reactContext
      val dm = ctx?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
      val display = dm?.getDisplay(Display.DEFAULT_DISPLAY)
      @Suppress("DEPRECATION")
      display?.hdrCapabilities?.supportedHdrTypes?.forEach {
        when (it) {
          Display.HdrCapabilities.HDR_TYPE_HDR10 -> hdr.add("hdr10")
          Display.HdrCapabilities.HDR_TYPE_HLG -> hdr.add("hlg")
          Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> hdr.add("dovi")
          else -> if (Build.VERSION.SDK_INT >= 29 && it == Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS) hdr.add("hdr10+")
        }
      }
      mapOf(
        "decoders" to decoders.sorted(),
        "maxWidth" to maxWidth,
        "maxHeight" to maxHeight,
        "hdr" to hdr,
        "hevcMain10" to hevcMain10,
        "model" to (Build.MANUFACTURER + " " + Build.MODEL),
      )
    }
  }
}
