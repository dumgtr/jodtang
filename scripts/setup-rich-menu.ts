import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { env } from '../src/config/env';

async function setupRichMenu() {
  console.log('====================================================');
  console.log('🖼️ Setting up JodTang LINE Rich Menu (v1.2.0)');
  console.log('====================================================\n');

  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing in environment!');
  }

  const imagePath = path.resolve(__dirname, '../jodtang-rich-menu-2500x843.png');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Rich menu image not found at ${imagePath}`);
  }

  // 1. Verify and resize image if necessary
  const metadata = await sharp(imagePath).metadata();
  console.log(`Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

  let imageBuffer: Buffer;
  if (metadata.width !== 2500 || metadata.height !== 843 || metadata.format !== 'png') {
    console.log('Resizing image to exact 2500 x 843 PNG format for LINE API...');
    imageBuffer = await sharp(imagePath)
      .resize(2500, 843, { fit: 'fill' })
      .png()
      .toBuffer();
    fs.writeFileSync(imagePath, imageBuffer);
  } else {
    imageBuffer = fs.readFileSync(imagePath);
  }

  // 2. Step 1 — Create Rich Menu
  console.log('Step 1: Creating Rich Menu via LINE Messaging API...');
  const richMenuPayload = {
    size: {
      width: 2500,
      height: 843,
    },
    selected: true,
    name: 'JodTang - สรุปยอด',
    chatBarText: 'เมนูจดตัง',
    areas: [
      {
        bounds: {
          x: 0,
          y: 0,
          width: 2500,
          height: 843,
        },
        action: {
          type: 'message',
          label: 'สรุปยอด',
          text: '📊 สรุปยอด',
        },
      },
    ],
  };

  const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(richMenuPayload),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Rich Menu (${createRes.status}): ${errorText}`);
  }

  const createData = (await createRes.json()) as { richMenuId: string };
  const richMenuId = createData.richMenuId;
  console.log(`✅ Created Rich Menu: ${richMenuId}`);

  fs.writeFileSync(path.resolve(__dirname, '../.richmenu-id-v120.txt'), richMenuId, 'utf-8');

  // 3. Step 2 — Upload Image
  console.log('Step 2: Uploading Rich Menu Image...');
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Failed to upload Rich Menu image (${uploadRes.status}): ${errorText}`);
  }
  console.log('✅ Rich Menu image uploaded successfully.');

  // 4. Step 3 — Set as Default Rich Menu
  console.log('Step 3: Setting Rich Menu as Default for all users...');
  const setDefaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!setDefaultRes.ok) {
    const errorText = await setDefaultRes.text();
    throw new Error(`Failed to set default Rich Menu (${setDefaultRes.status}): ${errorText}`);
  }

  console.log('\n============================================');
  console.log('🎉 JodTang Rich Menu is now DEFAULT for all users!');
  console.log(`Rich Menu ID: ${richMenuId}`);
  console.log('============================================\n');
}

setupRichMenu().catch((err) => {
  console.error('❌ Rich Menu Setup Failed:', err);
  process.exit(1);
});
