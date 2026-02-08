import { cors, checkAuth, clankerGet } from './shared.mjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req)) return res.status(401).json({ error: 'Invalid or missing API key' });

  const address = req.query.address;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid admin address' });
  }

  const tokens = await clankerGet(`/tokens?fid=&q=${address}&includeMarket=true`);
  return res.status(200).json(tokens);
}
