import { createPublicClient, http, decodeFunctionData } from 'viem';
import { base } from 'viem/chains';

const ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'owner', type: 'address' },
        { name: 'duration', type: 'uint256' },
        { name: 'resolver', type: 'address' },
        { name: 'data', type: 'bytes[]' },
        { name: 'reverseRecord', type: 'bool' }
      ]
    }],
    outputs: [],
    stateMutability: 'payable'
  }
];

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

// Successful tx (sniper registering axiombot)
const successTx = await publicClient.getTransaction({ hash: '0xe7f60be3a12828589c7da79d11c7f84d0247d009dee5e4421c93f82fbdfdcc2c' });
console.log('=== SUCCESSFUL TX (axiombot) ===');
try {
  const decoded = decodeFunctionData({ abi: ABI, data: successTx.input });
  console.log('Function:', decoded.functionName);
  console.log('Args:', JSON.stringify(decoded.args, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.log('Could not decode with register ABI, trying raw...');
  console.log('Input data (first 200 chars):', successTx.input.slice(0, 200));
}
console.log('Value:', successTx.value.toString());
console.log('');

// My failed tx
const failTx = await publicClient.getTransaction({ hash: '0x3c3c8a82cd1c95017a551318078fcc431bb816500a8dc257b61c37833f256035' });
console.log('=== MY FAILED TX (axiombotx) ===');
try {
  const decoded = decodeFunctionData({ abi: ABI, data: failTx.input });
  console.log('Function:', decoded.functionName);
  console.log('Args:', JSON.stringify(decoded.args, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.log('Could not decode with register ABI, trying raw...');
  console.log('Input data (first 200 chars):', failTx.input.slice(0, 200));
}
console.log('Value:', failTx.value.toString());
