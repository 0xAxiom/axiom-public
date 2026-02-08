import { Request, Response, NextFunction } from 'express';
import { X402GateConfig } from './types.js';
/**
 * Create x402 payment gate middleware for Express
 */
export declare function x402Gate(config: X402GateConfig): (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
