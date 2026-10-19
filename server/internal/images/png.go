package images

import (
	"image"
	"image/png"
	"io"
)

func encodePNG(w io.Writer, img image.Image) error {
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	return enc.Encode(w, img)
}
