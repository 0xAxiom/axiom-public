import { createWalletClient, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const REGISTRAR = '0xa7d2607c6BD39Ae9521e514026CBB078405Ab322';
const RESOLVER = '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875';

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

const privateKey = process.env.NET_PRIVATE_KEY;
const account = privateKeyToAccount(privateKey);

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

const name = 'axiombotx';
const duration = 31536000n;
const paymentAmount = 1500000000000000n; // 0.0015 ETH

try {
  const result = await publicClient.simulateContract({
    address: REGISTRAR,
    abi: ABI,
    functionName: 'register',
    args: [{
      name,
      owner: account.address,
      duration,
      resolver: RESOLVER,
      data: [],
      reverseRecord: true
    }],
    value: paymentAmount,
    account
  });
  console.log('Simulation succeeded:', result);
} catch (error) {
  console.log('Simulation failed!');
  console.log('Error name:', error.name);
  console.log('Error message:', error.shortMessage || error.message);
  if (error.cause) {
    console.log('Cause:', error.cause.reason || error.cause.message || error.cause);
  }
  if (error.data) {
    console.log('Data:', error.data);
  }
}
