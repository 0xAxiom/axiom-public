-- Agent Pulse Database Schema

-- Agent Registry
CREATE TABLE IF NOT EXISTS agents (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  twitter TEXT,
  framework TEXT DEFAULT 'unknown',
  added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Transaction Records  
CREATE TABLE IF NOT EXISTS transactions (
  hash TEXT PRIMARY KEY,
  agent_address TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('swap', 'lp', 'bridge', 'mint', 'transfer', 'other')),
  protocol TEXT,
  value_eth REAL DEFAULT 0,
  gas_used INTEGER,
  success BOOLEAN DEFAULT TRUE,
  timestamp INTEGER NOT NULL,
  block_number INTEGER,
  method_signature TEXT,
  decoded_data TEXT, -- JSON string
  FOREIGN KEY (agent_address) REFERENCES agents(address)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_address);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_protocol ON transactions(protocol);

-- Statistics cache (updated periodically)
CREATE TABLE IF NOT EXISTS stats_cache (
  id INTEGER PRIMARY KEY,
  agent_address TEXT,
  window_hours INTEGER,
  tx_count INTEGER DEFAULT 0,
  volume_eth REAL DEFAULT 0,
  category_breakdown TEXT, -- JSON string
  protocols TEXT, -- JSON array
  avg_gas REAL DEFAULT 0,
  success_rate REAL DEFAULT 1.0,
  last_updated INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(agent_address, window_hours)
);

-- Insert known agents
INSERT OR IGNORE INTO agents (address, name, twitter, framework) VALUES
  ('0x523Eff3dB03938eaa31a5a6FBd41E3B9d23edde5', 'AxiomBot', '@AxiomBot', 'clawdbot'),
  ('0x19fe674a83e98c44ad4c2172e006c542b8e8fe08', 'AxiomBot-Bankr', '@AxiomBot', 'clawdbot');