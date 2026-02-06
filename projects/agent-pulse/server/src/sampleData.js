// Sample data generator for demo purposes
const AgentPulseDB = require('./database');

function generateSampleData(db) {
  const sampleTransactions = [
    {
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      agent_address: '0x523eff3db03938eaa31a5a6fbd41e3b9d23edde5',
      category: 'swap',
      protocol: 'Uniswap',
      value_eth: 0.5,
      gas_used: 150000,
      success: true,
      timestamp: Math.floor(Date.now() / 1000) - 300,
      block_number: 12345678,
      method_signature: '0x414bf389',
      decoded_data: {
        to: '0x1234567890123456789012345678901234567890',
        value: '500000000000000000',
        signature_name: 'exactInputSingle'
      }
    },
    {
      hash: '0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      agent_address: '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
      category: 'lp',
      protocol: 'Aerodrome',
      value_eth: 2.1,
      gas_used: 220000,
      success: true,
      timestamp: Math.floor(Date.now() / 1000) - 600,
      block_number: 12345677,
      method_signature: '0xe8e33700',
      decoded_data: {
        to: '0x2234567890123456789012345678901234567890',
        value: '2100000000000000000',
        signature_name: 'addLiquidity'
      }
    },
    {
      hash: '0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      agent_address: '0x523eff3db03938eaa31a5a6fbd41e3b9d23edde5',
      category: 'mint',
      protocol: 'Zora',
      value_eth: 0.001,
      gas_used: 95000,
      success: true,
      timestamp: Math.floor(Date.now() / 1000) - 900,
      block_number: 12345676,
      method_signature: '0x6a627842',
      decoded_data: {
        to: '0x3234567890123456789012345678901234567890',
        value: '1000000000000000',
        signature_name: 'mint'
      }
    },
    {
      hash: '0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      agent_address: '0x523eff3db03938eaa31a5a6fbd41e3b9d23edde5',
      category: 'transfer',
      protocol: 'ETH',
      value_eth: 0.1,
      gas_used: 21000,
      success: true,
      timestamp: Math.floor(Date.now() / 1000) - 1200,
      block_number: 12345675,
      method_signature: '0x',
      decoded_data: {
        to: '0x4234567890123456789012345678901234567890',
        value: '100000000000000000',
        signature_name: 'transfer'
      }
    },
    {
      hash: '0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      agent_address: '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
      category: 'swap',
      protocol: 'Uniswap',
      value_eth: 1.2,
      gas_used: 180000,
      success: true,
      timestamp: Math.floor(Date.now() / 1000) - 1800,
      block_number: 12345674,
      method_signature: '0xc04b8d59',
      decoded_data: {
        to: '0x5234567890123456789012345678901234567890',
        value: '1200000000000000000',
        signature_name: 'exactInput'
      }
    }
  ];

  // Add sample transactions
  for (const tx of sampleTransactions) {
    db.addTransaction(tx);
  }

  console.log(`✅ Added ${sampleTransactions.length} sample transactions`);
}

module.exports = { generateSampleData };