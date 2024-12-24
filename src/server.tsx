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

// Data center coordinates [lat, lng]
const DATACENTER_LOCATIONS: Record<string, [number, number]> = {
  'us-west1': [45.5945, -122.1562],    // Oregon
  'us-east4': [38.7223, -77.0196],     // Virginia
  'europe-west4': [53.4478, 6.8367],   // Netherlands
  'asia-southeast1': [1.3521, 103.8198] // Singapore
};

// Region to Redis URL mapping
const REDIS_MAPPING = {
  'us-west1': process.env.REDIS_WEST_URL,
  'us-east4': process.env.REDIS_EAST_URL,
  'asia-southeast1': process.env.REDIS_ASIA_URL,
  'europe-west4': process.env.REDIS_EUROPE_URL
};

// Create Redis clients for all regions
const redisClients = new Map<string, ReturnType<typeof createClient>>();
const subscribers = new Map<string, ReturnType<typeof createClient>>();

// Cache for latest counts
const latestCounts = new Map<string, RegionState>();

// Connected WebSocket clients for updates
const clients = new Set<WebSocket>();

// Setup Redis connections
Object.entries(REDIS_MAPPING).forEach(([region, url]) => {
  if (url) {
    console.log(`Setting up Redis for ${region}...`);
    
    // Create main client
    const client = createClient({ url });
    redisClients.set(region, client);
    client.connect().catch(error => 
      console.error(`Failed to connect to Redis for ${region}:`, error)
    );
    
    // Create subscriber
    const subscriber = createClient({ url });
    subscribers.set(region, subscriber);
    subscriber.connect().catch(error => 
      console.error(`Failed to connect to Redis for ${region}:`, error)
    );
    
    // Initialize cache
    latestCounts.set(region, {
      region,
      count: 0,
      lastUpdate: new Date().toISOString()
    });
  } else {
    console.error(`No Redis URL configured for ${region}`);
  }
});

// Initialize Redis subscribers
async function initializeSubscribers() {
  for (const [region, subscriber] of subscribers.entries()) {
    try {
      await subscriber.subscribe('counter-updates', async (message) => {
        try {
          console.log(`Received message from ${region}:`, message);
          const update = JSON.parse(message);
          if (update.region) {
            latestCounts.set(update.region, {
              region: update.region,
              count: update.count,
              lastUpdate: update.lastUpdate
            });
          }
          
          // Broadcast to all WebSocket clients
          const wsMessage = JSON.stringify(update);
          clients.forEach(client => client.send(wsMessage));
        } catch (error) {
          console.error(`Error processing Redis message from ${region}:`, error);
        }
      });
      
      console.log(`Subscribed to updates from ${region}`);
    } catch (error) {
      console.error(`Failed to setup subscriber for ${region}:`, error);
    }
  }
}

initializeSubscribers().catch(console.error);

// Get counts from Redis
async function getAllCounts(): Promise<RegionState[]> {
  const counts: RegionState[] = [];
  
  for (const [region, client] of redisClients.entries()) {
    try {
      console.log(`Fetching count for ${region}...`);
      const value = await client.get(`counter:${region}`);
      console.log(`Got count for ${region}:`, value);
      
      const count = value ? parseInt(value, 10) : 0;
      const state = {
        region,
        count,
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
  return newValue;
}

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
    
      // Broadcast "connected" event to all clients
      const update = {
        type: "connected",
        region: REGION,
        count: latestCounts.get(REGION)?.count ?? 0,
        lastUpdate: new Date().toISOString(),
      };
      const wsMessage = JSON.stringify(update);
      clients.forEach(client => client.send(wsMessage));
    },
    close(ws) {
      clients.delete(ws);
    },
    async message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "connected" && data.location) {
          // Increment counter
          const newValue = await incrementCounter();
    
          // Create update message with location data
          const update = {
            type: "update",
            region: REGION,
            count: newValue,
            lastUpdate: new Date().toISOString(),
            connection: {
              from: {
                lat: data.location.lat,
                lng: data.location.lng,
                city: "Unknown",
                country: "Unknown"
              },
              to: {
                region: REGION,
                lat: DATACENTER_LOCATIONS[REGION][0],
                lng: DATACENTER_LOCATIONS[REGION][1]
              }
            }
          };
    
          // Update local cache and send update to all connected clients
          latestCounts.set(REGION, {
            region: REGION,
            count: newValue,
            lastUpdate: update.lastUpdate
          });
          const wsMessage = JSON.stringify(update);
          clients.forEach(client => client.send(wsMessage));
    
          // Broadcast to all regions via Redis
          for (const [_, client] of redisClients.entries()) {
            await client.publish('counter-updates', JSON.stringify(update));
          }
        }
        
        if (data.type === "increment" && data.location) {
          // Increment counter
          const newValue = await incrementCounter();
          
          // Create update message with location data
          const update = {
            type: "update",
            region: REGION,
            count: newValue,
            lastUpdate: new Date().toISOString(),
            connection: {
              from: {
                lat: data.location.lat,
                lng: data.location.lng,
                city: "Unknown",
                country: "Unknown"
              },
              to: {
                region: REGION,
                lat: DATACENTER_LOCATIONS[REGION][0],
                lng: DATACENTER_LOCATIONS[REGION][1]
              }
            }
          };
          
          // Send update to all connected WebSocket clients
          const wsMessage = JSON.stringify(update);
          clients.forEach(client => client.send(wsMessage));
          
          // Broadcast to all regions via Redis
          for (const [_, client] of redisClients.entries()) {
            await client.publish('counter-updates', JSON.stringify(update));
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to Redis instances: ${Array.from(redisClients.keys()).join(", ")}`);