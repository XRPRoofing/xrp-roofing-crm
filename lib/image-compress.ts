function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall back to HTMLImageElement below.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event);
    };
    img.src = url;
  });
}

/**
 * Downscale + re-encode an image file to a compact JPEG data URL before it is
 * stored/synced. Phone cameras produce multi-megabyte images; saving and
 * syncing those as base64 is slow. This caps the longest edge at `maxDimension`
 * and re-encodes at `quality`, typically shrinking payloads by 90%+.
 *
 * Falls back to the original file's data URL for non-images or if the canvas
 * pipeline is unavailable.
 */
export async function compressImageToDataUrl(
  file: File,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<string> {
  const { maxDimension = 1600, quality = 0.7 } = options;

  if (typeof window === "undefined" || typeof document === "undefined" || !file.type.startsWith("image/")) {
    return readFileAsDataUrl(file);
  }

  try {
    const source = await loadImage(file);
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    if (!sourceWidth || !sourceHeight) return readFileAsDataUrl(file);

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if ("close" in source && typeof source.close === "function") source.close();
      return readFileAsDataUrl(file);
    }
    ctx.drawImage(source, 0, 0, width, height);
    if ("close" in source && typeof source.close === "function") source.close();

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (!dataUrl.startsWith("data:image/jpeg")) return readFileAsDataUrl(file);

    // Approx decoded byte size of the JPEG (base64 is ~4/3 the byte count).
    const compressedBytes = Math.ceil((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
    return compressedBytes < file.size ? dataUrl : readFileAsDataUrl(file);
  } catch {
    return readFileAsDataUrl(file);
  }
}
