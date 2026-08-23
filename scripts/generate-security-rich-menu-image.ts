import sharp from 'sharp';
import path from 'path';

async function generateArtwork() {
  const width = 2500;
  const height = 843;

  // We create a clean SVG combining the top Summary section and the bottom Security section
  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Background Gradient -->
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FFBE1A" />
        <stop offset="50%" stop-color="#FFB300" />
        <stop offset="100%" stop-color="#FFA000" />
      </linearGradient>

      <!-- Bottom Bar Gradient -->
      <linearGradient id="barGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#F59E0B" />
        <stop offset="50%" stop-color="#D97706" />
        <stop offset="100%" stop-color="#B45309" />
      </linearGradient>

      <!-- Soft Shadow -->
      <filter id="dropShadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity="0.15" />
      </filter>
    </defs>

    <!-- Main Yellow Canvas -->
    <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

    <!-- Decorative subtle floating coins / dots in background -->
    <circle cx="200" cy="180" r="16" fill="#FFFFFF" opacity="0.4" />
    <circle cx="340" cy="360" r="10" fill="#FFFFFF" opacity="0.3" />
    <circle cx="2250" cy="160" r="22" fill="#FFFFFF" opacity="0.35" />
    <circle cx="2380" cy="320" r="14" fill="#FFFFFF" opacity="0.3" />

    <!-- TOP SECTION: 📊 สรุปยอด (y: 0 .. 562) -->
    <g transform="translate(680, 80)">
      <!-- White Circular Icon Base -->
      <circle cx="160" cy="180" r="130" fill="#FFFFFF" filter="url(#dropShadow)" />

      <!-- Chart Bars inside circle -->
      <rect x="95" y="210" width="30" height="45" rx="8" fill="#F59E0B" />
      <rect x="145" y="150" width="30" height="105" rx="8" fill="#FBBF24" />
      <rect x="195" y="110" width="30" height="145" rx="8" fill="#2563EB" />
      <rect x="80" y="255" width="160" height="14" rx="7" fill="#1E293B" />

      <!-- Text Header: สรุปยอด -->
      <text x="360" y="195" font-family="'Sarabun', 'Noto Sans Thai', 'Sukhumvit Set', sans-serif" font-weight="900" font-size="140" fill="#1E293B">สรุปยอด</text>

      <!-- Subtext: ดูรายรับรายจ่าย -->
      <text x="375" y="280" font-family="'Sarabun', 'Noto Sans Thai', 'Sukhumvit Set', sans-serif" font-weight="600" font-size="58" fill="#334155">⚡ ดูรายรับรายจ่าย</text>
    </g>

    <!-- DIVIDER LINE (y: 562) -->
    <line x1="120" y1="562" x2="2380" y2="562" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round" />

    <!-- BOTTOM SECTION: 🔒 ความปลอดภัยและความเป็นส่วนตัว (y: 562 .. 843) -->
    <g transform="translate(250, 595)">
      <!-- Rounded Button Container -->
      <rect x="0" y="0" width="2000" height="190" rx="95" fill="#FFFFFF" fill-opacity="0.95" filter="url(#dropShadow)" />
      <rect x="4" y="4" width="1992" height="182" rx="91" fill="none" stroke="#F59E0B" stroke-width="4" stroke-opacity="0.6" />

      <!-- Lock Icon -->
      <g transform="translate(480, 42)">
        <rect x="15" y="45" width="65" height="50" rx="10" fill="#0D9488" />
        <path d="M 28 45 L 28 28 A 19 19 0 0 1 66 28 L 66 45" fill="none" stroke="#0D9488" stroke-width="10" stroke-linecap="round" />
        <circle cx="47" cy="65" r="6" fill="#FFFFFF" />
        <rect x="45" y="65" width="4" height="14" fill="#FFFFFF" />
      </g>

      <!-- Security Text -->
      <text x="590" y="125" font-family="'Sarabun', 'Noto Sans Thai', 'Sukhumvit Set', sans-serif" font-weight="700" font-size="64" fill="#0F172A">ความปลอดภัยและความเป็นส่วนตัว</text>
    </g>
  </svg>
  `;

  const outputPath = path.resolve(__dirname, '../jodtang-rich-menu-security-2500x843.png');
  await sharp(Buffer.from(svg))
    .png()
    .toFile(outputPath);

  console.log(`✅ Generated Rich Menu artwork: ${outputPath} (${width}x${height} PNG)`);
}

generateArtwork().catch(console.error);
