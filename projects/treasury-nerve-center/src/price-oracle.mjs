/**
 * Price Oracle - CoinGecko API with CoinCap fallback
 * 60-second cache for rate limiting
 */

// Cache storage
const priceCache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

// Well-known token mappings for Base
const BASE_TOKENS = {
  // Native/wrapped ETH
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', coingeckoId: 'ethereum' },
  // USDC
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', coingeckoId: 'usd-coin' },
  // USDbC (bridged USDC)
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', coingeckoId: 'usd-coin' },
  // DAI
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', coingeckoId: 'dai' },
  // cbETH
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', coingeckoId: 'coinbase-wrapped-staked-eth' },
  // AERO
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', coingeckoId: 'aerodrome-finance' },
};

// CoinCap symbol mappings (uses symbols not addresses)
const COINCAP_SYMBOLS = {
  'WETH': 'ethereum',
  'ETH': 'ethereum',
  'USDC': 'usd-coin',
  'USDbC': 'usd-coin',
  'DAI': 'dai',
  'cbETH': 'coinbase-wrapped-staked-eth',
  'AERO': 'aerodrome-finance',
};

/**
 * Get cached price or null if expired/missing
 */
function getCachedPrice(address) {
  const cached = priceCache.get(address.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }
  return null;
}

/**
 * Set price in cache
 */
function setCachedPrice(address, price) {
  priceCache.set(address.toLowerCase(), {
    price,
    timestamp: Date.now(),
  });
}

/**
 * Fetch prices from CoinGecko (primary source)
 * Uses the simple/price endpoint with coin IDs for reliability
 * @param {string[]} addresses - Token contract addresses
 * @param {string} chain - Chain identifier (base, ethereum, etc.)
 * @returns {Promise<Object>} Address -> price mapping
 */
async function fetchCoinGeckoPrices(addresses, chain = 'base') {
  const prices = {};
  
  // Filter to addresses we don't have cached
  const needsFetch = addresses.filter(addr => getCachedPrice(addr) === null);
  
  if (needsFetch.length === 0) {
    // Return cached prices
    for (const addr of addresses) {
      prices[addr.toLowerCase()] = getCachedPrice(addr);
    }
    return prices;
  }

  try {
    // Map addresses to CoinGecko IDs
    const idsToFetch = [];
    const addrToId = {};
    
    for (const addr of needsFetch) {
      const tokenInfo = BASE_TOKENS[addr.toLowerCase()];
      if (tokenInfo?.coingeckoId) {
        idsToFetch.push(tokenInfo.coingeckoId);
        addrToId[tokenInfo.coingeckoId] = addr.toLowerCase();
      }
    }
    
    if (idsToFetch.length === 0) {
      return prices;
    }
    
    // Use simple/price endpoint (more reliable)
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${[...new Set(idsToFetch)].join(',')}&vs_currencies=usd&include_24hr_change=true`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Map back to addresses
    for (const [coinId, priceData] of Object.entries(data)) {
      if (priceData.usd) {
        // Find all addresses that use this coin ID
        for (const [addr, tokenInfo] of Object.entries(BASE_TOKENS)) {
          if (tokenInfo.coingeckoId === coinId) {
            prices[addr.toLowerCase()] = {
              usd: priceData.usd,
              change24h: priceData.usd_24h_change || 0,
              source: 'coingecko',
            };
            setCachedPrice(addr, prices[addr.toLowerCase()]);
          }
        }
      }
    }
  } catch (error) {
    console.error('CoinGecko fetch error:', error.message);
    // Will fall through to return cached + unfetched as null
  }

  // Fill in cached values for addresses we didn't need to fetch
  for (const addr of addresses) {
    if (!prices[addr.toLowerCase()]) {
      const cached = getCachedPrice(addr);
      if (cached) {
        prices[addr.toLowerCase()] = cached;
      }
    }
  }

  return prices;
}

/**
 * Fetch prices from CoinCap (fallback source)
 * @param {string[]} symbols - Token symbols
 * @returns {Promise<Object>} Symbol -> price mapping
 */
async function fetchCoinCapPrices(symbols) {
  const prices = {};
  
  try {
    // CoinCap uses asset IDs, need to map symbols
    const assetIds = symbols
      .map(s => COINCAP_SYMBOLS[s.toUpperCase()])
      .filter(Boolean);
    
    if (assetIds.length === 0) return prices;

    const url = `https://api.coincap.io/v2/assets?ids=${[...new Set(assetIds)].join(',')}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`CoinCap API error: ${response.status}`);
    }

    const data = await response.json();
    
    for (const asset of data.data || []) {
      const price = parseFloat(asset.priceUsd);
      const change = parseFloat(asset.changePercent24Hr) || 0;
      
      // Map back to symbols
      for (const [symbol, assetId] of Object.entries(COINCAP_SYMBOLS)) {
        if (assetId === asset.id) {
          prices[symbol.toUpperCase()] = {
            usd: price,
            change24h: change,
            source: 'coincap',
          };
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('CoinCap fetch error:', error.message);
    }
  }

  return prices;
}

/**
 * Get token price with fallback logic
 * @param {string} address - Token contract address
 * @param {string} chain - Chain identifier
 * @returns {Promise<Object|null>} Price data or null
 */
export async function getTokenPrice(address, chain = 'base') {
  const addrLower = address.toLowerCase();
  
  // Check cache first
  const cached = getCachedPrice(addrLower);
  if (cached) {
    return cached;
  }

  // Try CoinGecko first
  const cgPrices = await fetchCoinGeckoPrices([address], chain);
  if (cgPrices[addrLower]) {
    return cgPrices[addrLower];
  }

  // Fallback to CoinCap using symbol mapping
  const tokenInfo = BASE_TOKENS[addrLower];
  if (tokenInfo) {
    const capPrices = await fetchCoinCapPrices([tokenInfo.symbol]);
    if (capPrices[tokenInfo.symbol.toUpperCase()]) {
      const price = capPrices[tokenInfo.symbol.toUpperCase()];
      setCachedPrice(addrLower, price);
      return price;
    }
  }

  // Special case: stablecoins default to $1
  if (tokenInfo && ['USDC', 'USDbC', 'DAI'].includes(tokenInfo.symbol)) {
    const fallbackPrice = { usd: 1.0, change24h: 0, source: 'fallback' };
    setCachedPrice(addrLower, fallbackPrice);
    return fallbackPrice;
  }

  return null;
}

/**
 * Get multiple token prices at once
 * @param {string[]} addresses - Token contract addresses
 * @param {string} chain - Chain identifier
 * @returns {Promise<Object>} Address -> price mapping
 */
export async function getTokenPrices(addresses, chain = 'base') {
  const prices = {};
  
  // First try batch fetch from CoinGecko
  const cgPrices = await fetchCoinGeckoPrices(addresses, chain);
  Object.assign(prices, cgPrices);

  // For any missing, try CoinCap fallback
  const missing = addresses.filter(addr => !prices[addr.toLowerCase()]);
  
  if (missing.length > 0) {
    const symbols = missing
      .map(addr => BASE_TOKENS[addr.toLowerCase()]?.symbol)
      .filter(Boolean);
    
    if (symbols.length > 0) {
      const capPrices = await fetchCoinCapPrices(symbols);
      
      for (const addr of missing) {
        const tokenInfo = BASE_TOKENS[addr.toLowerCase()];
        if (tokenInfo && capPrices[tokenInfo.symbol.toUpperCase()]) {
          prices[addr.toLowerCase()] = capPrices[tokenInfo.symbol.toUpperCase()];
          setCachedPrice(addr, prices[addr.toLowerCase()]);
        }
      }
    }
  }

  return prices;
}

/**
 * Get ETH/native token price
 * @param {string} chain - Chain identifier
 * @returns {Promise<Object>} Price data
 */
export async function getEthPrice(chain = 'base') {
  // WETH address on Base
  const wethAddress = '0x4200000000000000000000000000000000000006';
  return getTokenPrice(wethAddress, chain);
}

/**
 * Get token info from address
 * @param {string} address - Token contract address
 * @returns {Object|null} Token info
 */
export function getTokenInfo(address) {
  return BASE_TOKENS[address.toLowerCase()] || null;
}

/**
 * Clear the price cache (for testing)
 */
export function clearPriceCache() {
  priceCache.clear();
}

export default {
  getTokenPrice,
  getTokenPrices,
  getEthPrice,
  getTokenInfo,
  clearPriceCache,
};
