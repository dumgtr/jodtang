import 'dotenv/config';
import fs from 'node:fs';

async function main() {
  const secret = process.env.SLIP2GO_API_SECRET;
  if (!secret) {
    console.error('Error: SLIP2GO_API_SECRET is not set in process.env or .env');
    process.exit(1);
  }

  const imagePath = 'C:/Users/Thanit Jit/.gemini/antigravity/brain/7143fcf6-bf14-44cf-8c77-7311ec4d326f/.user_uploaded/media_1788247359485.jpg';
  if (!fs.existsSync(imagePath)) {
    console.error('Error: Slip image not found at', imagePath);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const blob = new Blob([imageBuffer], { type: 'image/jpeg' });

  const form = new FormData();
  form.append('file', blob, 'slip.jpg');
  form.append('payload', JSON.stringify({ checkDuplicate: false }));

  console.log('Sending slip image to https://connect.slip2go.com/api/verify-slip/qr-image/info...');

  try {
    const res = await fetch('https://connect.slip2go.com/api/verify-slip/qr-image/info', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      body: form,
    });

    const data = await res.json();
    console.log('\n--- Slip2Go Raw Response ---');
    console.log(JSON.stringify(data, null, 2));

    if (data && (data.code === '200000' || data.code === '200001' || res.status === 200)) {
      console.log('\n✅ Slip Verified Successfully!');
    }
  } catch (error: any) {
    console.error('Error verifying slip:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
