import { cors, checkAuth, clankerGet } from './shared.mjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Invalid or missing API key' });

  const address = req.query.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid token address' });
  }

  const [tokenInfo, fees] = await Promise.all([
    clankerGet(`/tokens/${address}`),
    clankerGet(`/tokens/${address}/uncollected-fees`),
  ]);

  return res.status(200).json({ token: tokenInfo, uncollectedFees: fees });
}
