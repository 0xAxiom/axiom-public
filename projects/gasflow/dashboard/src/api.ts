import type { Chain, Prediction, RouteComparison, MarketSummary } from './types';

const API_BASE = 'http://localhost:3001/api';

export class GasFlowAPI {
  static async getGasData(): Promise<{ chains: Chain[] }> {
    const response = await fetch(`${API_BASE}/gas`);
    if (!response.ok) {
      throw new Error('Failed to fetch gas data');
    }
    return await response.json();
  }

  static async getChainGas(chainId: number): Promise<any> {
    const response = await fetch(`${API_BASE}/gas/${chainId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch gas data for chain ${chainId}`);
    }
    return await response.json();
  }

  static async getPrediction(chainId: number): Promise<{ prediction: Prediction; chainName: string }> {
    const response = await fetch(`${API_BASE}/predict/${chainId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch prediction for chain ${chainId}`);
    }
    return await response.json();
  }

  static async optimizeRoute(action: string, value: number, userChain?: number): Promise<{ optimization: RouteComparison }> {
    const params = new URLSearchParams({
      action,
      value: value.toString()
    });
    
    if (userChain) {
      params.append('userChain', userChain.toString());
    }

    const response = await fetch(`${API_BASE}/route?${params}`);
    if (!response.ok) {
      throw new Error('Failed to optimize route');
    }
    return await response.json();
  }

  static async getSummary(): Promise<{ summary: MarketSummary }> {
    const response = await fetch(`${API_BASE}/summary`);
    if (!response.ok) {
      throw new Error('Failed to fetch market summary');
    }
    return await response.json();
  }

  static createWebSocket(): WebSocket {
    return new WebSocket('ws://localhost:3001/ws');
  }
}