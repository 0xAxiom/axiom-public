import { cors } from './shared.mjs';

export default function handler(req, res) {
  cors(res);
  res.status(200).json({
    service: 'Agent Launchpad',
    version: '2.1.0',
    status: 'ok',
    endpoints: {
      launch: 'POST /api/launch',
      status: 'GET /api/status/{tokenAddress}',
      fees: 'GET /api/fees/{adminAddress}',
    },
  });
}
