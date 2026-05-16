#!/usr/bin/env node
// Poll mainnet for incoming Normies ERC-721 Transfer to AxiomBot.
// Logs to stdout; appends discoveries to ./incoming.json.

import { ethers } from "ethers";
import fs from "node:fs";
import { CHAINS, getProvider, loadEnv } from "./lib.mjs";

loadEnv();
const chain = process.argv[2] || "mainnet";
const c = CHAINS[chain];
const wallet = (process.argv[3] || process.env.AXIOM_WALLET_ADDRESS).toLowerCase();
const provider = getProvider(chain);

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const toTopic = "0x" + wallet.replace(/^0x/, "").padStart(64, "0");

console.log(`[watch] chain=${chain} wallet=${wallet} normies=${c.normies}`);
let lastBlock = Number(await provider.getBlockNumber());
console.log(`[watch] starting at block ${lastBlock}`);

const recordPath = new URL("./incoming.json", import.meta.url);
function record(entry) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(recordPath, "utf8")); } catch {}
  list.push(entry);
  fs.writeFileSync(recordPath, JSON.stringify(list, null, 2));
}

while (true) {
  try {
    const head = Number(await provider.getBlockNumber());
    if (head > lastBlock) {
      const logs = await provider.getLogs({
        address: c.normies,
        fromBlock: lastBlock + 1,
        toBlock: head,
        topics: [TRANSFER_TOPIC, null, toTopic],
      });
      for (const log of logs) {
        const tokenId = BigInt(log.topics[3]).toString();
        const from = "0x" + log.topics[1].slice(26);
        const entry = {
          ts: new Date().toISOString(),
          chain,
          block: log.blockNumber,
          tx: log.transactionHash,
          from,
          to: wallet,
          tokenId,
        };
        console.log(`[watch] NORMIE INCOMING: tokenId=${tokenId} from=${from} tx=${log.transactionHash} block=${log.blockNumber}`);
        record(entry);
      }
      lastBlock = head;
    }
  } catch (e) {
    console.error(`[watch] poll error: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 15000));
}
