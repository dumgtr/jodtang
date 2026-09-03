import sharp from 'sharp';
import jsQR, { QRCode } from 'jsqr';

export type QrDetectionStatus =
  | 'SINGLE_QR'
  | 'MULTIPLE_QR'
  | 'UNREADABLE_QR'
  | 'NO_QR';

export interface QrDetectionResult {
  status: QrDetectionStatus;
  payload?: string;
  payloads?: string[];
  reason?: string;
  processingTimeMs: number;
}

/**
 * Cross-checks a candidate finder pattern vertically through its center (centerX, centerY)
 * to ensure 1:1:3:1:1 module ratio in 2D space.
 */
function crossCheckVertical(
  data: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  maxTotalWidth: number
): boolean {
  let y = centerY;
  const counts = [0, 0, 0, 0, 0];

  // Helper to test if pixel is dark
  const isDark = (px: number, py: number): boolean => {
    if (px < 0 || px >= width || py < 0 || py >= height) return false;
    const idx = (py * width + px) * 4;
    const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
    return lum < 120;
  };

  // Center must be dark
  if (!isDark(centerX, centerY)) return false;

  // Scan up from center for center black segment
  let top = centerY;
  while (top >= 0 && isDark(centerX, top)) {
    counts[2]++;
    top--;
  }
  // Scan up for inner white
  while (top >= 0 && !isDark(centerX, top)) {
    counts[1]++;
    top--;
  }
  // Scan up for outer black
  while (top >= 0 && isDark(centerX, top)) {
    counts[0]++;
    top--;
  }

  // Scan down from center for center black segment
  let bottom = centerY + 1;
  while (bottom < height && isDark(centerX, bottom)) {
    counts[2]++;
    bottom++;
  }
  // Scan down for inner white
  while (bottom < height && !isDark(centerX, bottom)) {
    counts[3]++;
    bottom++;
  }
  // Scan down for outer black
  while (bottom < height && isDark(centerX, bottom)) {
    counts[4]++;
    bottom++;
  }

  const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
  if (Math.abs(total - maxTotalWidth) > maxTotalWidth * 0.5) return false;

  const moduleSize = total / 7;
  const maxVar = moduleSize * 0.5;

  return (
    counts[0] > 0 &&
    counts[1] > 0 &&
    counts[2] > 0 &&
    counts[3] > 0 &&
    counts[4] > 0 &&
    Math.abs(counts[0] - moduleSize) < maxVar &&
    Math.abs(counts[1] - moduleSize) < maxVar &&
    Math.abs(counts[2] - 3 * moduleSize) < 3 * maxVar &&
    Math.abs(counts[3] - moduleSize) < maxVar &&
    Math.abs(counts[4] - moduleSize) < maxVar
  );
}

/**
 * Scans for true 2D QR finder patterns (3 concentric squares with 1:1:3:1:1 ratio in both X and Y).
 * Requires at least 2 verified 2D finder patterns to report credible QR evidence.
 */
export function hasQrFinderPatternEvidence(
  data: Uint8ClampedArray | Buffer,
  width: number,
  height: number
): boolean {
  let confirmed2dPatterns = 0;

  // Sample every 4th row
  for (let y = 4; y < height - 4; y += 4) {
    let state = 0;
    const counts = [0, 0, 0, 0, 0];

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
      const isBlack = lum < 120;

      if (isBlack) {
        if (state === 1 || state === 3) state++;
        counts[state]++;
      } else {
        if (state === 0 || state === 2) {
          state++;
          counts[state] = 1;
        } else if (state === 4) {
          const totalWidth = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
          if (totalWidth >= 14) { // Real QR finder patterns on 1000px images are at least 14px wide
            const moduleSize = totalWidth / 7;
            const maxVariance = moduleSize * 0.5;

            if (
              Math.abs(counts[0] - moduleSize) < maxVariance &&
              Math.abs(counts[1] - moduleSize) < maxVariance &&
              Math.abs(counts[2] - 3 * moduleSize) < 3 * maxVariance &&
              Math.abs(counts[3] - moduleSize) < maxVariance &&
              Math.abs(counts[4] - moduleSize) < maxVariance
            ) {
              // Calculate center X of the candidate
              const centerX = Math.floor(x - counts[4] - counts[3] - counts[2] / 2);
              if (crossCheckVertical(data, width, height, centerX, y, totalWidth)) {
                confirmed2dPatterns++;
                if (confirmed2dPatterns >= 2) return true;
              }
            }
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        } else {
          counts[state]++;
        }
      }
    }
  }

  return confirmed2dPatterns >= 2;
}

/**
 * Masks a rectangular region of an RGBA image buffer with white pixels (255, 255, 255, 255).
 * Used to detect secondary QR codes without allocating a full image copy.
 */
function maskDetectedRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  loc: QRCode['location']
): void {
  const minX = Math.max(0, Math.floor(Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x) - 15));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x) + 15));
  const minY = Math.max(0, Math.floor(Math.min(loc.topLeftCorner.y, loc.topRightCorner.y) - 15));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y) + 15));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
}

/**
 * In-memory QR detection and extraction pipeline using sharp & jsQR.
 * Pure in-memory execution, zero external network calls.
 */
export async function detectAndDecodeQr(imageBuffer: Buffer): Promise<QrDetectionResult> {
  const startTime = Date.now();

  try {
    // Benchmark optimization: Resize to max 720px dimension.
    // Sharp leverages libvips fast shrink-on-load for JPEG images.
    // 720px provides ~24px per QR module, which is optimal for jsQR accuracy and achieves <= 30-50ms latency.
    const maxDimension = 720;
    const sharpInstance = sharp(imageBuffer)
      .rotate()
      .resize(maxDimension, maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
      });

    const { data, info } = await sharpInstance
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelArray = new Uint8ClampedArray(data);

    // 2. Primary Scan Pass with attemptBoth
    const primaryResult = jsQR(pixelArray, info.width, info.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (primaryResult && primaryResult.data) {
      const firstPayload = primaryResult.data;

      // 3. Multiple QR check: Mask primary region and re-scan
      maskDetectedRegion(pixelArray, info.width, info.height, primaryResult.location);
      const secondaryResult = jsQR(pixelArray, info.width, info.height, {
        inversionAttempts: 'dontInvert',
      });

      if (secondaryResult && secondaryResult.data && secondaryResult.data !== firstPayload) {
        return {
          status: 'MULTIPLE_QR',
          payloads: [firstPayload, secondaryResult.data],
          reason: 'MULTIPLE_DISTINCT_QR_CODES_DETECTED',
          processingTimeMs: Date.now() - startTime,
        };
      }

      return {
        status: 'SINGLE_QR',
        payload: firstPayload,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 4. Quick Finder Pattern Check: Avoid expensive reprocessing if zero QR evidence exists
    const hasFinderPattern = hasQrFinderPatternEvidence(
      pixelArray,
      info.width,
      info.height
    );

    if (!hasFinderPattern) {
      return {
        status: 'NO_QR',
        reason: 'NO_QR_MATRIX_FOUND',
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 5. If finder patterns WERE found but decode failed, attempt contrast normalization
    const contrastBuffer = await sharp(imageBuffer)
      .rotate()
      .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
      .normalize()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const secondaryAttempt = jsQR(
      new Uint8ClampedArray(contrastBuffer.data),
      contrastBuffer.info.width,
      contrastBuffer.info.height,
      { inversionAttempts: 'attemptBoth' }
    );

    if (secondaryAttempt && secondaryAttempt.data) {
      return {
        status: 'SINGLE_QR',
        payload: secondaryAttempt.data,
        processingTimeMs: Date.now() - startTime,
      };
    }

    return {
      status: 'UNREADABLE_QR',
      reason: 'QR_FINDER_PATTERNS_DETECTED_BUT_DECODE_FAILED',
      processingTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      status: 'UNREADABLE_QR',
      reason: `DECODE_EXCEPTION: ${err?.message || 'UNKNOWN_ERROR'}`,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
