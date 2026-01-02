import React from "react";
import { renderToString } from "react-dom/server";
import { Counter } from "./components/Counter";
import { createClient } from 'redis';
import type { ServerWebSocket } from "bun";

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
  'asia-southeast1': [1.3521, 103.8198], // Singapore
  'us-west2': [45.5945, -122.1562],    // Oregon (metal)
  'us-east4-eqdc4a': [38.7223, -77.0196], // Virginia (metal)
  'europe-west4-drams3a': [53.4478, 6.8367], // Netherlands (metal)
  'asia-southeast1-eqsg3a': [1.3521, 103.8198] // Singapore (metal)
};

// Region to Redis URL mapping
const REDIS_MAPPING = {
  'us-west1': process.env.REDIS_WEST_URL,
  'us-west2': process.env.REDIS_WEST_URL,  // Metal Oregon -> West Redis
  'us-east4': process.env.REDIS_EAST_URL,
  'us-east4-eqdc4a': process.env.REDIS_EAST_URL,  // Metal Virginia -> East Redis
  'asia-southeast1': process.env.REDIS_ASIA_URL,
  'asia-southeast1-eqsg3a': process.env.REDIS_ASIA_URL,  // Metal Singapore -> Asia Redis
  'europe-west4': process.env.REDIS_EUROPE_URL,
  'europe-west4-drams3a': process.env.REDIS_EUROPE_URL  // Metal Netherlands -> Europe Redis
};

// Client bundle cache
let clientBundle: Uint8Array | null = null;

// State cache
let cachedRegions: RegionState[] | null = null;
const CACHE_TTL = 1000; // 1 second
let lastCacheTime = 0;

// Redis clients and state
const redisClients = new Map<string, ReturnType<typeof createClient>>();
const subscribers = new Map<string, ReturnType<typeof createClient>>();
const latestCounts = new Map<string, RegionState>();
// Store both location and connection for each user
const connectedUsers = new Map<ServerWebSocket<unknown>, {
  location: { lat: number; lng: number };
  connection: Connection;
}>();
interface Connection {
  id: string;  // Add unique id
  from: {
    lat: number;
    lng: number;
    city: string;
    country: string;
  };
  to: {
    region: string;
    lat: number;
    lng: number;
  };
}

const clients = new Set<WebSocket>();
let subscribersInitialized = false;

// Setup Redis connections in parallel
async function setupRedisConnections() {
  const connectionPromises = Object.entries(REDIS_MAPPING).map(async ([region, url]) => {
    if (!url) {
      console.error(`No Redis URL configured for ${region}`);
      return;
    }
    
    console.log(`Setting up Redis for ${region}...`);
    
    try {
      // Create both client and subscriber in parallel
      const [client, subscriber] = await Promise.all([
        createClient({ url }).connect(),
        createClient({ url }).connect()
      ]);
      
      redisClients.set(region, client);
      subscribers.set(region, subscriber);
      
      latestCounts.set(region, {
        region,
        count: 0,
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Failed to connect to Redis for ${region}:`, error);
    }
  });

  await Promise.all(connectionPromises);
}

// Initialize Redis subscribers
async function initializeSubscribers() {
  const subscribePromises = Array.from(subscribers.entries()).map(async ([region, subscriber]) => {
    try {
      await subscriber.subscribe('counter-updates', async (message) => {
        try {
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
  });

  await Promise.all(subscribePromises);
}

// Get counts from Redis with parallel queries
async function getAllCounts(): Promise<RegionState[]> {
  const countPromises = Array.from(redisClients.entries()).map(async ([region, client]) => {
    try {
      const value = await client.get(`counter:${region}`);
      const count = value ? parseInt(value, 10) : 0;
      const state = {
        region,
        count,
        lastUpdate: new Date().toISOString()
      };
      
      latestCounts.set(region, state);
      return state;
    } catch (error) {
      console.error(`Error getting count for ${region}:`, error);
      return {
        region,
        count: 0,
        lastUpdate: new Date().toISOString()
      };
    }
  });
  
  return Promise.all(countPromises);
}

let BUILD_TIMESTAMP = Date.now();

// Get cached client bundle
async function getClientBundle() {
  if (!clientBundle || process.env.NODE_ENV !== 'production') {
    console.log("Firing bundle!");
    const build = await Bun.build({
      entrypoints: ['./src/client.tsx'],
      outdir: './public',
      naming: `[name].${BUILD_TIMESTAMP}.js`,
    });
    clientBundle = build.outputs[0];
  }
  return clientBundle;
}

// Get cached initial state
async function getInitialState() {
  const now = Date.now();
  if (!cachedRegions || now - lastCacheTime > CACHE_TTL) {
    cachedRegions = await getAllCounts();
    lastCacheTime = now;
  }
  return cachedRegions;
}

// Setup subscribers if not initialized
async function setupSubscribersIfNeeded() {
  if (subscribersInitialized) return;
  await initializeSubscribers();
  subscribersInitialized = true;
}

// Increment counter and publish update
async function incrementCounter(): Promise<number> {
  const client = redisClients.get(REGION);
  if (!client) throw new Error(`No Redis client for ${REGION}`);
  
  const key = `counter:${REGION}`;
  const newValue = await client.incr(key);
  return newValue;
}

// Initialize Redis connections
setupRedisConnections().catch(console.error);

const cacheControl = () => {
  if (process.env.NODE_ENV === 'production') {
    return { 
      'Cache-Control': 'public, max-age=31536000',
      'Pragma': '',
      'Expires': '',
    }
  }
  return {
    'Cache-Control': 'no-cache, no-store, must-revalidate', 
    'Pragma': 'no-cache',
    'Expires': '0'
  }
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
  
    // Serve cached client bundle
    if (url.pathname.startsWith('/client.')) {
      const bundle = await getClientBundle();
      return new Response(bundle, {
        headers: { 
          'Content-Type': 'text/javascript',
          // Disable caching in development
          // TODO: NODE_ENV == production cache this
          ...cacheControl(),
        }
      });
    }
  
    // Server-side render with cached state
    const regions = await getInitialState();
    const content = renderToString(<Counter regions={regions} currentRegion={REGION} />);
    
    return new Response(
      `<!DOCTYPE html>
        <html>
          <head>
            <title>jakecooper.me</title>
            <style>
              html, 
              body, 
              #root, 
              #__next {
                margin: 0;
                padding: 0;
                background: #13111C !important;
                min-height: 100vh;
                color: white;
              }
              * {
                box-sizing: border-box;
              }
            </style>
            <script src="/client.${BUILD_TIMESTAMP}.js" type="module" defer></script>
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
    async open(ws) {
      await setupSubscribersIfNeeded();
      clients.add(ws);
      
      // Send current state including existing connections
      const regions = Array.from(latestCounts.values());
      const connectedLocations = Array.from(connectedUsers.values()).map(u => u.location);
      const existingConnections = Array.from(connectedUsers.values()).map(u => u.connection);
      
      await ws.send(JSON.stringify({ 
        type: "state", 
        regions,
        connectedUsers: connectedLocations,
        connections: existingConnections
      }));
    },
    
    async close(ws) {
      // Get user data before removing
      const userData = connectedUsers.get(ws);
      
      // Remove user when they disconnect
      connectedUsers.delete(ws);
      clients.delete(ws);
      
      if (userData) {
        // Broadcast updated user list and connection removal
        const connectedLocations = Array.from(connectedUsers.values()).map(u => u.location);
        const update = {
          type: "userUpdate",
          connectedUsers: connectedLocations,
          disconnectedUser: {
            location: userData.location,
            connection: userData.connection
          }
        };
        
        const wsMessage = JSON.stringify(update);
        await Promise.all(
          Array.from(clients)
            .filter(client => client !== ws)
            .map(client => client.send(wsMessage))
        );
      }
    },
    
    async message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === "connected" && data.location) {
          // Create connection data
          const connection: Connection = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,  // Unique ID
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
          };
          
          // Store both location and connection
          connectedUsers.set(ws, {
            location: {
              lat: data.location.lat,
              lng: data.location.lng
            },
            connection
          });
          
          // Prepare updates
          const connectedLocations = Array.from(connectedUsers.values()).map(u => u.location);
          const userUpdate = {
            type: "userUpdate",
            connectedUsers: connectedLocations
          };
          
          // Broadcast to other clients in parallel
          const wsMessage = JSON.stringify(userUpdate);
          const broadcastPromise = Promise.all(
            Array.from(clients)
              .filter(client => client !== ws)
              .map(client => client.send(wsMessage))
          );
          
          // Increment counter and create connection update
          const newValue = await incrementCounter();
          const connectionUpdate = {
            type: "update",
            region: REGION,
            count: newValue,
            lastUpdate: new Date().toISOString(),
            connection
          };
          
          // Broadcast all updates in parallel
          const connectionMessage = JSON.stringify(connectionUpdate);
          await Promise.all([
            broadcastPromise,
            // Send to WebSocket clients
            ...Array.from(clients).map(client => 
              client.send(connectionMessage)
            ),
            // Broadcast to Redis
            ...Array.from(redisClients.values()).map(client => 
              client.publish('counter-updates', connectionMessage)
            )
          ]);
        }
        
        // Keep rest of message handler...
      } catch (error) {
        console.error("Error processing message:", error);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to Redis instances: ${Array.from(redisClients.keys()).join(", ")}`);