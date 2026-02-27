async function addDomain(domain) {
  const token = 'sk-jv6llouj6aos5mi6puocvxp5qefvn';
  const fullDomain = domain + '.zeabur.app';
  const res = await fetch('https://api.zeabur.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      query: `mutation { addDomain(serviceID: "69a1a75f79f74da9ed5a809c", domain: "${fullDomain}", isGenerated: true) { domain } }`
    })
  });
  const data = await res.json();
  if (data.data?.addDomain) {
    console.log('SUCCESS:', data.data.addDomain.domain);
    return true;
  }
  console.log(domain + ': ' + (data.errors?.[0]?.message || 'failed'));
  return false;
}

async function main() {
  const names = [
    'maidian-sg', 'sg-maidian', 'maidian-tia', 'sellpoint-sg',
    'md-sellpoint', 'maidian-2026', 'tia-sellpoint', 'starglow-md',
    'maidian-pro', 'ai-maidian', 'maidian-run', 'maidian-go'
  ];
  for (const n of names) {
    if (await addDomain(n)) return;
  }
  console.log('All names taken!');
}
main();
