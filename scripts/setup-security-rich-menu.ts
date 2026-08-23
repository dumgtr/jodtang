import fs from 'fs';
import path from 'path';
import { env } from '../src/config/env';
import { buildJodTangRichMenuRequest } from '../src/utils/menu.builder';

async function setupSecurityRichMenu() {
  console.log('====================================================');
  console.log('🖼️ Setting up JodTang Security FAQ Rich Menu');
  console.log('====================================================\n');

  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing in environment!');
  }

  const imagePath = path.resolve(__dirname, '../jodtang-rich-menu-security-2500x843.png');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Rich menu image not found at ${imagePath}`);
  }

  // 1. Get current default Rich Menu
  const prevDefaultRes = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const prevDefaultData = await prevDefaultRes.json();
  console.log('Previous Default Rich Menu ID:', prevDefaultData);

  // 2. Step 1: Create Rich Menu
  console.log('\nStep 1: Creating new Rich Menu via LINE Messaging API...');
  const richMenuPayload = buildJodTangRichMenuRequest();
  console.log('Payload:', JSON.stringify(richMenuPayload, null, 2));

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
  const newRichMenuId = createData.richMenuId;
  console.log(`✅ Created New Rich Menu: ${newRichMenuId}`);

  // 3. Step 2: Upload Image
  console.log('\nStep 2: Uploading 2500x843 image to new Rich Menu...');
  const imageBuffer = fs.readFileSync(imagePath);
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${newRichMenuId}/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: imageBuffer,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Failed to upload image (${uploadRes.status}): ${errorText}`);
  }
  console.log('✅ Image uploaded successfully.');

  // 4. Step 3: Set as Default for all users
  console.log('\nStep 3: Setting new Rich Menu as Default for all users...');
  const setDefaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${newRichMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!setDefaultRes.ok) {
    const errorText = await setDefaultRes.text();
    throw new Error(`Failed to set default Rich Menu (${setDefaultRes.status}): ${errorText}`);
  }
  console.log('✅ New Rich Menu is now set as Default.');

  // 5. Step 4: Verify Default on LINE API
  console.log('\nStep 4: Verifying Default Rich Menu on LINE API...');
  const verifyRes = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const verifyData = await verifyRes.json();
  console.log('Current Active Default Rich Menu:', JSON.stringify(verifyData, null, 2));

  // Update local tracker file
  fs.writeFileSync(path.resolve(__dirname, '../.richmenu-id-v120.txt'), newRichMenuId, 'utf-8');

  console.log('\n====================================================');
  console.log('🎉 SECURITY FAQ RICH MENU IS LIVE!');
  console.log(`New Rich Menu ID: ${newRichMenuId}`);
  console.log(`Previous Rich Menu Retained as Fallback.`);
  console.log('====================================================\n');
}

setupSecurityRichMenu().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
