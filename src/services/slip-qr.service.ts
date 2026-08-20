import sharp from 'sharp';
import jsQR from 'jsqr';
import { logInternalError } from '../utils/errors';

/**
 * Reserved deterministic utility for future slip support; Sprint 1 image handling does not invoke it.
 */
export class SlipQRService {
  /**
   * Scans an image buffer for a QR code.
   * Applies image preprocessing (resizing, contrast normalization, thresholding)
   * to maximize decoding accuracy on compressed or low-light mobile slips.
   */
  static async scanQRCode(imageBuffer: Buffer): Promise<string | null> {
    try {
      // Pass 1: Direct raw RGBA extraction
      const pass1 = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const code1 = jsQR(
        new Uint8ClampedArray(pass1.data),
        pass1.info.width,
        pass1.info.height
      );

      if (code1 && code1.data) {
        console.log('[SlipQRService] QR Code detected in Pass 1');
        return code1.data;
      }

      // Pass 2: Grayscale + Normalize contrast + Auto threshold
      const pass2 = await sharp(imageBuffer)
        .grayscale()
        .normalize()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const code2 = jsQR(
        new Uint8ClampedArray(pass2.data),
        pass2.info.width,
        pass2.info.height
      );

      if (code2 && code2.data) {
        console.log('[SlipQRService] QR Code detected in Pass 2 (Enhanced)');
        return code2.data;
      }

      // Pass 3: Resized (width 1000px) + Sharpened
      const pass3 = await sharp(imageBuffer)
        .resize({ width: 1000, withoutEnlargement: false })
        .grayscale()
        .sharpen()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const code3 = jsQR(
        new Uint8ClampedArray(pass3.data),
        pass3.info.width,
        pass3.info.height
      );

      if (code3 && code3.data) {
        console.log('[SlipQRService] QR Code detected in Pass 3 (Resized/Sharpened)');
        return code3.data;
      }

      return null;
    } catch (error) {
      logInternalError('[SlipQRService] Failed during QR scanning preprocessing', error);
      return null;
    }
  }
}
