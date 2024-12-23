import React from "react";
import { renderToString } from "react-dom/server";
import { Counter } from "./components/Counter";
import { createClient } from 'redis';

// Types
interface RegionState {
  count: number;
  lastUpdate: string;
}

// All known regions
const REGIONS = [
  'us-west2',
  'us-east1', 
  'asia-southeast',
  'europe-west'
];

const REGION = process.env.RAILWAY_REPLICA_REGION || "unknown-region";

// Create Redis clients for all regions
const redisClients = new Map<string, ReturnType<typeof createClient>>();

REGIONS.forEach(region => {
  const envVar = `REDIS_${region.toUpperCase().replace('-', '_')}_URL`;
  const url = process.env[envVar];
  if (url) {
    const client = createClient({ url });
    redisClients.set(region, client);
    // Connect to Redis
    client.connect().catch(error => 
      console.error(`Failed to connect to Redis for ${region}:`, error)
    );
  }
});

// Get counts from all Redis instances
async function getAllCounts(): Promise<RegionState[]> {
  const counts: RegionState[] = [];
  console.log("Getting counts for regions:", Array.from(redisClients.keys()));
  
  for (const [region, client] of redisClients.entries()) {
    try {
      console.log(`Fetching count for ${region}...`);
      const value = await client.get(`counter:${region}`) || '0';
      console.log(`Got count for ${region}:`, value);
      counts.push({
        region,
        count: parseInt(value, 10),
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Error getting count for ${region}:`, error);
      counts.push({
        region,
        count: 0,
        lastUpdate: new Date().toISOString()
      });
    }
  }
  
  console.log("Final counts:", counts);
  return counts;
}

// Increment counter for current region
async function incrementCounter(): Promise<number> {
  const client = redisClients.get(REGION);
  if (!client) throw new Error(`No Redis client for ${REGION}`);
  
  const key = `counter:${REGION}`;
  const newValue = await client.incr(key);
  return newValue;
}

// Connected WebSocket clients for updates
const clients = new Set<WebSocket>();

// Broadcast current state to all connected clients
async function broadcastToClients() {
  try {
    const regions = await getAllCounts();
    const message = JSON.stringify({ type: "state", regions });
    clients.forEach(client => client.send(message));
  } catch (error) {
    console.error('Error broadcasting to clients:', error);
  }
}

// Start a periodic sync to keep all clients up to date
setInterval(() => {
  if (clients.size > 0) {
    broadcastToClients();
  }
}, 1000); // Sync every second

const server = Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade
    if (req.headers.get("Upgrade") === "websocket") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
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
    return getAllCounts().then(regions => {
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
    });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      broadcastToClients();
    },
    close(ws) {
      clients.delete(ws);
    },
    async message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "increment") {
          await incrementCounter();
          await broadcastToClients();
        }
      } catch (e) {
        console.error("Error processing message:", e);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to Redis instances: ${Array.from(redisClients.keys()).join(", ")}`);