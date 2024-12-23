import React from "react";
import { renderToString } from "react-dom/server";
import { Counter } from "./components/Counter";
import { createClient } from 'redis';

// Types
interface RegionState {
  region: string;
  count: number;
  lastUpdate: string;
}

// Region configuration
const REGION = process.env.RAILWAY_REPLICA_REGION || "unknown-region";

// Region to Redis URL mapping
const REDIS_MAPPING = {
  'us-west1': process.env.REDIS_WEST_URL,
  'us-east4': process.env.REDIS_EAST_URL,
  'asia-southeast1': process.env.REDIS_ASIA_URL,
  'europe-west4': process.env.REDIS_EUROPE_URL
};

// Create Redis clients for all regions
const redisClients = new Map<string, ReturnType<typeof createClient>>();
// Separate client for subscriptions
const subscriber = createClient({ url: process.env.REDIS_WEST_URL });

// Cache for latest counts
const latestCounts = new Map<string, RegionState>();

console.log("Available env vars:", Object.keys(process.env).filter(key => key.includes('REDIS')));

// Setup Redis connections
Object.entries(REDIS_MAPPING).forEach(([region, url]) => {
  console.log(`Setting up Redis for ${region} with URL ${url?.slice(0, 10)}...`);
  if (url) {
    const client = createClient({ url });
    redisClients.set(region, client);
    // Connect to Redis
    client.connect().catch(error => 
      console.error(`Failed to connect to Redis for ${region}:`, error)
    );
    
    // Initialize cache with 0
    latestCounts.set(region, {
      region,
      count: 0,
      lastUpdate: new Date().toISOString()
    });
  } else {
    console.log(`No Redis URL configured for ${region}`);
  }
});

// Setup subscriber
async function setupSubscriber() {
  await subscriber.connect();
  
  // Subscribe to all region channels
  await subscriber.subscribe('counter-updates', (message) => {
    try {
      const update = JSON.parse(message);
      latestCounts.set(update.region, {
        region: update.region,
        count: update.count,
        lastUpdate: update.lastUpdate
      });
      
      // Broadcast to all WebSocket clients
      const regions = Array.from(latestCounts.values());
      const wsMessage = JSON.stringify({ type: "state", regions });
      clients.forEach(client => client.send(wsMessage));
    } catch (error) {
      console.error('Error processing Redis message:', error);
    }
  });
}

setupSubscriber().catch(console.error);

// Get counts from cache or Redis if needed
async function getAllCounts(): Promise<RegionState[]> {
  // First try to get from cache
  if (latestCounts.size > 0) {
    return Array.from(latestCounts.values());
  }
  
  // Fallback to Redis if cache is empty
  const counts: RegionState[] = [];
  console.log("Cache miss - getting counts from Redis");
  
  for (const [region, client] of redisClients.entries()) {
    try {
      const value = await client.get(`counter:${region}`) || '0';
      const state = {
        region,
        count: parseInt(value, 10),
        lastUpdate: new Date().toISOString()
      };
      counts.push(state);
      latestCounts.set(region, state);
    } catch (error) {
      console.error(`Error getting count for ${region}:`, error);
      counts.push({
        region,
        count: 0,
        lastUpdate: new Date().toISOString()
      });
    }
  }
  
  return counts;
}

// Increment counter and publish update
async function incrementCounter(): Promise<number> {
  const client = redisClients.get(REGION);
  if (!client) throw new Error(`No Redis client for ${REGION}`);
  
  const key = `counter:${REGION}`;
  const newValue = await client.incr(key);
  
  // Publish update
  const update = {
    region: REGION,
    count: newValue,
    lastUpdate: new Date().toISOString()
  };
  
  // Update cache
  latestCounts.set(REGION, update);
  
  // Publish to Redis
  const publisher = redisClients.get(REGION);
  await publisher?.publish('counter-updates', JSON.stringify(update));
  
  return newValue;
}

// Connected WebSocket clients for updates
const clients = new Set<WebSocket>();

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade
    if (req.headers.get("Upgrade") === "websocket") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // Increment counter only on the main page request
    if (url.pathname === '/') {
      await incrementCounter();
    }

    // Ignore favicon.ico requests
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 404 });
    }

    // Serve client bundle
    if (url.pathname === '/client.js') {
      return Bun.build({
        entrypoints: ['./src/client.tsx'],
        outdir: './public',
        naming: '[name].js',
      }).then(output => {
        return new Response(output.outputs[0], {
          headers: { 'Content-Type': 'text/javascript' }
        });
      });
    }

    // Server-side render
    const regions = await getAllCounts();
    const content = renderToString(<Counter regions={regions} currentRegion={REGION} />);
    
    return new Response(
      `<!DOCTYPE html>
        <html>
          <head>
            <title>Global Counter Network - ${REGION}</title>
            <script src="/client.js" type="module" defer></script>
          </head>
          <body>
            <div id="root">${content}</div>
            <script>
              window.__INITIAL_DATA__ = {
                regions: ${JSON.stringify(regions)},
                currentRegion: "${REGION}"
              };
            </script>
          </body>
        </html>`,
      {
        headers: { "Content-Type": "text/html" },
      }
    );
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      // Send current state from cache immediately
      const regions = Array.from(latestCounts.values());
      ws.send(JSON.stringify({ type: "state", regions }));
    },
    close(ws) {
      clients.delete(ws);
    },
    async message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "increment") {
          await incrementCounter();
        }
      } catch (e) {
        console.error("Error processing message:", e);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to Redis instances: ${Array.from(redisClients.keys()).join(", ")}`);