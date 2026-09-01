import 'dotenv/config';

async function main() {
  const secret = process.env.SLIP2GO_API_SECRET;
  if (!secret) {
    console.error('Error: SLIP2GO_API_SECRET is not set in process.env or .env');
    process.exit(1);
  }

  // Probe both connect.slip2go.com and api.slip2go.com
  const endpoints = [
    'https://connect.slip2go.com/api/account/info',
    'https://api.slip2go.com/api/account/info',
  ];

  for (const url of endpoints) {
    console.log(`\nTesting endpoint: ${url}`);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));

      if (data && (data.code === '200001' || data.code === 200001 || res.status === 200)) {
        console.log(`\n✅ Slip2Go Authentication Successful! (${url})`);
        return;
      }
    } catch (error: any) {
      console.error(`Error with ${url}:`, error.message);
    }
  }
}

main().catch(console.error);
