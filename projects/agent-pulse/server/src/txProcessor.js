const { createPublicClient, http, parseAbiItem } = require('viem');
const { base } = require('viem/chains');

// Common function signatures for categorization
const FUNCTION_SIGNATURES = {
  // Uniswap V3/V4
  '0x414bf389': { name: 'exactInputSingle', category: 'swap', protocol: 'Uniswap' },
  '0xc04b8d59': { name: 'exactInput', category: 'swap', protocol: 'Uniswap' },
  '0x5ae401dc': { name: 'multicall', category: 'swap', protocol: 'Uniswap' },
  '0x12210e8a': { name: 'exactOutputSingle', category: 'swap', protocol: 'Uniswap' },
  
  // Uniswap V2 style (Aerodrome, etc.)
  '0x5c11d795': { name: 'swapExactTokensForTokens', category: 'swap', protocol: 'Aerodrome' },
  '0x022c0d9f': { name: 'swap', category: 'swap', protocol: 'Aerodrome' },
  
  // Liquidity operations
  '0xe8e33700': { name: 'addLiquidity', category: 'lp', protocol: 'Uniswap' },
  '0xbaa2abde': { name: 'removeLiquidity', category: 'lp', protocol: 'Uniswap' },
  '0x4515cef3': { name: 'addLiquidityETH', category: 'lp', protocol: 'Aerodrome' },
  '0x02751cec': { name: 'removeLiquidityETH', category: 'lp', protocol: 'Aerodrome' },
  
  // NFT mints
  '0x6a627842': { name: 'mint', category: 'mint', protocol: 'Zora' },
  '0xa0712d68': { name: 'mint', category: 'mint', protocol: 'Base' },
  '0x40c10f19': { name: 'mint', category: 'mint', protocol: 'ERC20' },
  
  // Bridge operations
  '0x7ff36ab5': { name: 'swapAndBridge', category: 'bridge', protocol: 'Stargate' },
  '0x1a58b9b0': { name: 'bridge', category: 'bridge', protocol: 'LayerZero' },
  
  // Transfers
  '0xa9059cbb': { name: 'transfer', category: 'transfer', protocol: 'ERC20' },
  '0x23b872dd': { name: 'transferFrom', category: 'transfer', protocol: 'ERC20' },
  
  // Common patterns
  '0x095ea7b3': { name: 'approve', category: 'other', protocol: 'ERC20' },
  '0x2e1a7d4d': { name: 'withdraw', category: 'other', protocol: 'WETH' },
  '0xd0e30db0': { name: 'deposit', category: 'other', protocol: 'WETH' },
};

// Known contract addresses for better categorization
const KNOWN_CONTRACTS = {
  // Uniswap
  '0x2626664c2603336e57b271c5c0b26f421741e481': 'Uniswap V3 Router',
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24': 'Uniswap Universal Router',
  
  // Aerodrome
  '0xcd7c1a8c1e8c0b2b6b6bd3b5a0e9b2b8e9b2b8e9': 'Aerodrome Router',
  
  // Base tokens
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
};

class TransactionProcessor {
  constructor(etherscanApiKey) {
    this.client = createPublicClient({
      chain: base,
      transport: http('https://mainnet.base.org')
    });
    this.etherscanApiKey = etherscanApiKey;
  }

  async processTransaction(tx, receipt = null) {
    try {
      // Get transaction receipt if not provided
      if (!receipt && tx.hash) {
        receipt = await this.client.getTransactionReceipt({ hash: tx.hash });
      }

      const methodSig = tx.input?.slice(0, 10);
      const signature = FUNCTION_SIGNATURES[methodSig];
      
      let category = 'other';
      let protocol = null;
      let valueEth = 0;

      // Categorize based on method signature
      if (signature) {
        category = signature.category;
        protocol = signature.protocol;
      }

      // Special handling for ETH transfers
      if (tx.value && parseFloat(tx.value) > 0) {
        if (category === 'other' || !tx.input || tx.input === '0x') {
          category = 'transfer';
          protocol = 'ETH';
        }
        valueEth = this.weiToEth(tx.value);
      }

      // Try to extract value from logs for token operations
      if (receipt && receipt.logs) {
        valueEth = Math.max(valueEth, this.extractValueFromLogs(receipt.logs));
      }

      const processed = {
        hash: tx.hash,
        agent_address: tx.from?.toLowerCase(),
        category,
        protocol,
        value_eth: valueEth,
        gas_used: receipt?.gasUsed ? Number(receipt.gasUsed) : Number(tx.gas || 0),
        success: receipt ? receipt.status === 'success' : true,
        timestamp: Math.floor(Date.now() / 1000),
        block_number: tx.blockNumber ? Number(tx.blockNumber) : null,
        method_signature: methodSig,
        decoded_data: {
          to: tx.to,
          value: tx.value,
          input: tx.input,
          signature_name: signature?.name || 'unknown'
        }
      };

      return processed;
    } catch (error) {
      console.error('Error processing transaction:', error);
      return null;
    }
  }

  weiToEth(wei) {
    return parseFloat(wei) / 1e18;
  }

  extractValueFromLogs(logs) {
    // Try to extract value from Transfer events
    let maxValue = 0;
    
    for (const log of logs) {
      try {
        // ERC20 Transfer event signature
        if (log.topics?.[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
          const value = log.data;
          if (value && value !== '0x') {
            const ethValue = this.weiToEth(BigInt(value).toString());
            maxValue = Math.max(maxValue, ethValue);
          }
        }
      } catch (e) {
        // Ignore log parsing errors
      }
    }
    
    return maxValue;
  }

  async getHistoricalTransactions(address, limit = 100) {
    try {
      const url = `https://api.etherscan.io/v2/api?chainid=8453&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${this.etherscanApiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === '1' && data.result) {
        const processed = [];
        for (const tx of data.result) {
          const processedTx = await this.processTransaction(tx);
          if (processedTx) {
            processed.push(processedTx);
          }
        }
        return processed;
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching historical transactions:', error);
      return [];
    }
  }
}

module.exports = TransactionProcessor;