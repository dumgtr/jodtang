import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

async function generateArtwork() {
  const width = 2500;
  const height = 843;

  // Master Image: Approved 2162x727 Source of Truth
  const masterImagePath = path.resolve(
    __dirname,
    '../a_bright_clean_flat_vector_app_menu_dashboard_ba.png.png'
  );

  if (!fs.existsSync(masterImagePath)) {
    throw new Error(`Master artwork not found at: ${masterImagePath}`);
  }

  console.log(`Using approved Master Image: ${masterImagePath}`);

  // Direct geometric scale of approved Master artwork using Lanczos3 kernel
  const imageBuffer = await sharp(masterImagePath)
    .resize(width, height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .png({
      quality: 100,
      compressionLevel: 9,
    })
    .toBuffer();

  const outPath1 = path.resolve(__dirname, '../jodtang-rich-menu-2500x843.png');
  const outPath2 = path.resolve(__dirname, '../jodtang-rich-menu-security-2500x843.png');

  fs.writeFileSync(outPath1, imageBuffer);
  fs.writeFileSync(outPath2, imageBuffer);

  console.log(`✅ Directly scaled Rich Menu artwork saved (${width}x${height} PNG):`);
  console.log(`   - ${outPath1}`);
  console.log(`   - ${outPath2}`);
}

generateArtwork().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
