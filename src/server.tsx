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

// Create Redis clients - one writer for our region and subscribers for all regions
const localRedis = createClient({ url: REDIS_MAPPING[REGION] });
const subscribers = new Map<string, ReturnType<typeof createClient>>();

// Cache for latest counts
const latestCounts = new Map<string, RegionState>();

// Connected WebSocket clients for updates
const clients = new Set<WebSocket>();

// Initialize connections
async function initializeRedis() {
  try {
    // Connect local Redis for writing
    await localRedis.connect();
    console.log('Connected to local Redis');

    // Create and connect subscribers for each region
    for (const [region, url] of Object.entries(REDIS_MAPPING)) {
      if (!url) continue;

      const subscriber = createClient({ url });
      subscribers.set(region, subscriber);

      try {
        await subscriber.connect();
        console.log(`Connected subscriber to ${region}`);

        // Subscribe to updates from this region
        await subscriber.subscribe(`counter:${region}:updates`, async (message) => {
          try {
            const update = JSON.parse(message);
            latestCounts.set(update.region, update);

            // Broadcast to all WebSocket clients
            const regions = Array.from(latestCounts.values());
            const wsMessage = JSON.stringify({ type: "state", regions });
            clients.forEach(client => client.send(wsMessage));
          } catch (error) {
            console.error(`Error processing update from ${region}:`, error);
          }
        });

        // Get initial count for this region
        const count = await subscriber.get(`counter:${region}`) || '0';
        latestCounts.set(region, {
          region,
          count: parseInt(count, 10),
          lastUpdate: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error connecting to ${region}:`, error);
        // We'll keep trying to reconnect for failed regions
        retryConnection(region, url);
      }
    }
  } catch (error) {
    console.error('Redis initialization error:', error);
    // Retry initialization after delay
    setTimeout(initializeRedis, 5000);
  }
}

// Retry connection to a region
async function retryConnection(region: string, url: string, delay = 5000) {
  while (true) {
    try {
      const subscriber = createClient({ url });
      await subscriber.connect();
      
      subscribers.set(region, subscriber);
      await subscriber.subscribe(`counter:${region}:updates`, async (message) => {
        try {
          const update = JSON.parse(message);
          latestCounts.set(update.region, update);
          broadcastToClients();
        } catch (error) {
          console.error(`Error processing update from ${region}:`, error);
        }
      });

      console.log(`Successfully reconnected to ${region}`);
      break;
    } catch (error) {
      console.error(`Retry connection to ${region} failed:`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Broadcast current state to all WebSocket clients
function broadcastToClients() {
  const regions = Array.from(latestCounts.values());
  const wsMessage = JSON.stringify({ type: "state", regions });
  clients.forEach(client => client.send(wsMessage));
}

// Increment counter
async function incrementCounter(): Promise<number> {
  const key = `counter:${REGION}`;
  const newValue = await localRedis.incr(key);

  // Create update message
  const update = {
    region: REGION,
    count: newValue,
    lastUpdate: new Date().toISOString()
  };

  // Update local cache
  latestCounts.set(REGION, update);

  // Publish update to our region's channel
  await localRedis.publish(`counter:${REGION}:updates`, JSON.stringify(update));

  return newValue;
}

// Initialize Redis connections
initializeRedis().catch(console.error);

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
    const regions = Array.from(latestCounts.values());
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
      // Send current state immediately
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
      } catch (error) {
        console.error("Error processing message:", error);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log('Connected to Redis instances:', Array.from(subscribers.keys()).join(', '));