const fs = require('fs');
const path = require('path');

class AgentPulseDB {
  constructor(dataDir = './data') {
    this.dataDir = dataDir;
    this.agentsFile = path.join(dataDir, 'agents.json');
    this.transactionsFile = path.join(dataDir, 'transactions.json');
    
    this.init();
  }

  init() {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Initialize agents file with known agents
    if (!fs.existsSync(this.agentsFile)) {
      const knownAgents = [
        {
          address: '0x523eff3db03938eaa31a5a6fbd41e3b9d23edde5',
          name: 'AxiomBot',
          twitter: '@AxiomBot',
          framework: 'clawdbot',
          added_at: Math.floor(Date.now() / 1000)
        },
        {
          address: '0x19fe674a83e98c44ad4c2172e006c542b8e8fe08',
          name: 'AxiomBot-Bankr',
          twitter: '@AxiomBot',
          framework: 'clawdbot',
          added_at: Math.floor(Date.now() / 1000)
        }
      ];
      this.saveData(this.agentsFile, knownAgents);
    }

    // Initialize transactions file
    if (!fs.existsSync(this.transactionsFile)) {
      this.saveData(this.transactionsFile, []);
    }

    console.log('✅ Database initialized');
  }

  loadData(filename) {
    try {
      const data = fs.readFileSync(filename, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading ${filename}:`, error);
      return [];
    }
  }

  saveData(filename, data) {
    try {
      fs.writeFileSync(filename, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`Error saving ${filename}:`, error);
      return false;
    }
  }

  // Agent methods
  getAgents() {
    return this.loadData(this.agentsFile);
  }

  getAgent(address) {
    const agents = this.getAgents();
    return agents.find(agent => agent.address.toLowerCase() === address.toLowerCase());
  }

  addAgent(agent) {
    const agents = this.getAgents();
    const exists = agents.find(a => a.address.toLowerCase() === agent.address.toLowerCase());
    
    if (exists) {
      return { changes: 0 };
    }

    agents.push({
      ...agent,
      address: agent.address.toLowerCase(),
      added_at: Math.floor(Date.now() / 1000)
    });

    this.saveData(this.agentsFile, agents);
    return { changes: 1 };
  }

  // Transaction methods
  addTransaction(tx) {
    const transactions = this.loadData(this.transactionsFile);
    const exists = transactions.find(t => t.hash === tx.hash);
    
    if (exists) {
      return { changes: 0 };
    }

    transactions.unshift({ // Add to beginning for latest-first order
      ...tx,
      agent_address: tx.agent_address.toLowerCase()
    });

    // Keep only last 1000 transactions to prevent file from growing too large
    if (transactions.length > 1000) {
      transactions.splice(1000);
    }

    this.saveData(this.transactionsFile, transactions);
    return { changes: 1 };
  }

  getTransactions(limit = 50, category = null, agent = null) {
    let transactions = this.loadData(this.transactionsFile);
    const agents = this.getAgents();

    // Filter by category
    if (category) {
      transactions = transactions.filter(tx => tx.category === category);
    }

    // Filter by agent
    if (agent) {
      transactions = transactions.filter(tx => tx.agent_address.toLowerCase() === agent.toLowerCase());
    }

    // Add agent names
    transactions = transactions.map(tx => {
      const agent = agents.find(a => a.address.toLowerCase() === tx.agent_address.toLowerCase());
      return {
        ...tx,
        agent_name: agent ? agent.name : 'Unknown Agent'
      };
    });

    return transactions.slice(0, limit);
  }

  getAgentStats(address, hoursWindow = 24) {
    const since = Math.floor(Date.now() / 1000) - (hoursWindow * 3600);
    const transactions = this.loadData(this.transactionsFile);
    
    const agentTxs = transactions.filter(tx => 
      tx.agent_address.toLowerCase() === address.toLowerCase() && 
      tx.timestamp >= since
    );

    if (agentTxs.length === 0) {
      return {
        tx_count: 0,
        volume_eth: 0,
        avg_gas: 0,
        success_rate: 1,
        last_active: null,
        category_breakdown: {},
        protocols: []
      };
    }

    const stats = {
      tx_count: agentTxs.length,
      volume_eth: agentTxs.reduce((sum, tx) => sum + (tx.value_eth || 0), 0),
      avg_gas: agentTxs.reduce((sum, tx) => sum + (tx.gas_used || 0), 0) / agentTxs.length,
      success_rate: agentTxs.filter(tx => tx.success !== false).length / agentTxs.length,
      last_active: Math.max(...agentTxs.map(tx => tx.timestamp))
    };

    // Category breakdown
    const categoryBreakdown = {};
    agentTxs.forEach(tx => {
      categoryBreakdown[tx.category] = (categoryBreakdown[tx.category] || 0) + 1;
    });

    // Unique protocols
    const protocols = [...new Set(agentTxs.map(tx => tx.protocol).filter(p => p))];

    return {
      ...stats,
      category_breakdown: categoryBreakdown,
      protocols
    };
  }

  getAggregateStats(hoursWindow = 24) {
    const since = Math.floor(Date.now() / 1000) - (hoursWindow * 3600);
    const transactions = this.loadData(this.transactionsFile);
    
    const recentTxs = transactions.filter(tx => tx.timestamp >= since);

    const totalStats = {
      total_txs: recentTxs.length,
      total_volume: recentTxs.reduce((sum, tx) => sum + (tx.value_eth || 0), 0),
      active_agents: new Set(recentTxs.map(tx => tx.agent_address)).size
    };

    // Top protocols
    const protocolCounts = {};
    recentTxs.forEach(tx => {
      if (tx.protocol) {
        protocolCounts[tx.protocol] = (protocolCounts[tx.protocol] || 0) + 1;
      }
    });

    const topProtocols = Object.entries(protocolCounts)
      .map(([protocol, count]) => ({ protocol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top agents
    const agentVolumes = {};
    const agentTxCounts = {};
    recentTxs.forEach(tx => {
      agentVolumes[tx.agent_address] = (agentVolumes[tx.agent_address] || 0) + (tx.value_eth || 0);
      agentTxCounts[tx.agent_address] = (agentTxCounts[tx.agent_address] || 0) + 1;
    });

    const agents = this.getAgents();
    const topAgents = Object.entries(agentVolumes)
      .map(([address, volume_eth]) => {
        const agent = agents.find(a => a.address.toLowerCase() === address.toLowerCase());
        return {
          agent_address: address,
          name: agent ? agent.name : 'Unknown',
          volume_eth,
          tx_count: agentTxCounts[address]
        };
      })
      .sort((a, b) => b.volume_eth - a.volume_eth)
      .slice(0, 10);

    // Hourly activity
    const hourlyActivity = Array.from({ length: 24 }, (_, i) => ({ hour: i.toString().padStart(2, '0'), count: 0 }));
    recentTxs.forEach(tx => {
      const hour = new Date(tx.timestamp * 1000).getHours().toString().padStart(2, '0');
      const hourData = hourlyActivity.find(h => h.hour === hour);
      if (hourData) hourData.count++;
    });

    return {
      ...totalStats,
      top_protocols: topProtocols,
      top_agents: topAgents,
      hourly_activity: hourlyActivity
    };
  }

  isKnownAgent(address) {
    return !!this.getAgent(address);
  }

  close() {
    // No cleanup needed for file-based storage
  }
}

module.exports = AgentPulseDB;