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

// Consolidated region mapping for connections
const REGION_CONSOLIDATION = {
  'us-west1': 'US West',
  'us-west2': 'US West', // Metal Oregon
  'us-east1': 'US East',
  'us-east4': 'US East',
  'us-east4-eqdc4a': 'US East', // Metal Virginia
  'europe': 'Europe',
  'europe-west4': 'Europe',
  'europe-west4-drams3a': 'Europe', // Metal Netherlands
  'asia': 'Asia',
  'asia-southeast1': 'Asia',
  'asia-southeast1-eqsg3a': 'Asia' // Metal Singapore
};

// Get consolidated datacenter location for connection display
const getConsolidatedLocation = (region: string): [number, number] => {
  const consolidated = REGION_CONSOLIDATION[region] || region;
  switch (consolidated) {
    case 'US West': return [45.5945, -122.1562];    // Oregon
    case 'US East': return [38.7223, -77.0196];     // Virginia
    case 'Europe': return [53.4478, 6.8367];        // Netherlands
    case 'Asia': return [1.3521, 103.8198];         // Singapore
    default: return DATACENTER_LOCATIONS[region] || [0, 0];
  }
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

// Redis key for storing active connections
const CONNECTIONS_KEY = 'active-connections';

// Get the Redis client for the current region
function getRegionalRedisClient(): ReturnType<typeof createClient> | undefined {
  return redisClients.get(REGION);
}

// Store a connection in the regional Redis
async function storeConnectionInRedis(connection: Connection): Promise<void> {
  const client = getRegionalRedisClient();
  if (!client) return;

  try {
    await client.hSet(CONNECTIONS_KEY, connection.id, JSON.stringify(connection));
  } catch (error) {
    console.error('Error storing connection in Redis:', error);
  }
}

// Remove a connection from the regional Redis
async function removeConnectionFromRedis(connectionId: string): Promise<void> {
  const client = getRegionalRedisClient();
  if (!client) return;

  try {
    await client.hDel(CONNECTIONS_KEY, connectionId);
  } catch (error) {
    console.error('Error removing connection from Redis:', error);
  }
}

// Get unique Redis clients (since multiple regions may share the same Redis)
function getUniqueRedisClients(): ReturnType<typeof createClient>[] {
  const seen = new Set<string>();
  const unique: ReturnType<typeof createClient>[] = [];

  // Use the URL mapping to identify unique Redis instances
  const urlToClient = new Map<string, ReturnType<typeof createClient>>();

  for (const [region, url] of Object.entries(REDIS_MAPPING)) {
    if (url && !urlToClient.has(url)) {
      const client = redisClients.get(region);
      if (client) {
        urlToClient.set(url, client);
        unique.push(client);
      }
    }
  }

  return unique;
}

// Get all connections from ALL Redis instances (aggregate)
async function getAllConnectionsFromRedis(): Promise<Connection[]> {
  const allConnections: Connection[] = [];
  const seenIds = new Set<string>();

  // Only query unique Redis instances (not duplicates)
  const uniqueClients = getUniqueRedisClients();

  const promises = uniqueClients.map(async (client) => {
    try {
      const connectionsHash = await client.hGetAll(CONNECTIONS_KEY);
      return Object.values(connectionsHash).map(json => JSON.parse(json) as Connection);
    } catch (error) {
      console.error('Error fetching connections from Redis:', error);
      return [];
    }
  });

  const results = await Promise.all(promises);

  // Deduplicate by connection ID (shouldn't be needed now, but safe)
  for (const connections of results) {
    for (const conn of connections) {
      if (!seenIds.has(conn.id)) {
        seenIds.add(conn.id);
        allConnections.push(conn);
      }
    }
  }

  return allConnections;
}

// Clear stale connections from a Redis instance
async function clearStaleConnections(client: ReturnType<typeof createClient>, region: string): Promise<void> {
  try {
    const deleted = await client.del(CONNECTIONS_KEY);
    if (deleted > 0) {
      console.log(`Cleared ${deleted} stale connections from ${region} Redis`);
    }
  } catch (error) {
    console.error(`Error clearing connections from ${region}:`, error);
  }
}

// Setup Redis connections in parallel
async function setupRedisConnections() {
  const seenUrls = new Set<string>();

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

      // Clear stale connections on startup (only once per unique Redis instance)
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        await clearStaleConnections(client, region);
      }

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

    // Handle Railway team count API
    if (url.pathname === '/api/railway-team-count') {
      try {
        // Fetch the Railway about page
        const response = await fetch('https://railway.com/about');
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Extract the team section specifically
        const teamSectionMatch = html.match(/<section[^>]*class="[^"]*text-center[^"]*"[^>]*>[\s\S]*?<p[^>]*>Meet the train crew<[\s\S]*?<\/section>/i);
        
        if (teamSectionMatch) {
          const teamSection = teamSectionMatch[0];
          
          // Extract all alt attributes from images in the team section
          const altMatches = teamSection.match(/alt="([^"]+)"/g) || [];
          const uniqueNames = new Set();
          
          for (const altMatch of altMatches) {
            const name = altMatch.match(/alt="([^"]+)"/)?.[1];
            if (name && 
                name !== '' && 
                !name.includes('aria-hidden') &&
                !name.includes('Could be you') &&
                name !== 'Percy' && // Railway mascot
                !name.toLowerCase().includes('placeholder') &&
                !name.toLowerCase().includes('logo') &&
                !name.toLowerCase().includes('icon')
            ) {
              // Filter out investors/advisors (they have "Image of" prefix)
              // Only count direct team members (first names or "Name Lastname" format)
              if (!name.startsWith('Image of')) {
                uniqueNames.add(name);
              }
            }
          }
          
          const count = uniqueNames.size;
          
          // Sanity check - Railway team should be between 20-50 people
          if (count >= 20 && count <= 50) {
            return new Response(JSON.stringify({ count }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
        
        // Fallback to known accurate count if scraping fails
        return new Response(JSON.stringify({ count: 32 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error fetching Railway team count:', error);
        // Return fallback count  
        return new Response(JSON.stringify({ count: 32 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
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
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>justjake.me</title>
            <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%2313111C'/><circle cx='50' cy='50' r='30' fill='%23E835A0'/></svg>">
            <style>
              html,
              body,
              #root,
              #__next {
                margin: 0;
                padding: 0;
                background: #13111C !important;
                min-height: 100vh;
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              }
              * {
                box-sizing: border-box;
              }
              ::selection {
                background: rgba(232, 53, 160, 0.3);
                color: #E835A0;
              }
              a {
                color: #E835A0;
                text-decoration: none;
              }
              a:hover {
                text-decoration: underline;
              }

              /* Main layout - desktop default */
              .main-layout {
                display: grid;
                grid-template-columns: 500px 1fr;
                min-height: 100vh;
                background: #13111C;
                color: #ffffff;
                margin: 0;
                padding: 0;
                width: 100vw;
                position: absolute;
                left: 0;
                top: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              }

              .content-column {
                padding: 3rem;
                height: 100vh;
                overflow-y: auto;
                background: #13111C;
                border-right: 1px solid rgba(123, 12, 208, 0.2);
              }

              .pull-tab {
                display: none;
              }

              .globe-column {
                display: flex;
                align-items: center;
                justify-content: center;
                background: #13111C;
                overflow: hidden;
                position: relative;
                padding-bottom: 80px;
              }

              @keyframes pulse-glow {
                0%, 100% {
                  box-shadow: 0 0 20px rgba(123, 12, 208, 0.3), 0 0 40px rgba(232, 53, 160, 0.1);
                }
                50% {
                  box-shadow: 0 0 30px rgba(123, 12, 208, 0.5), 0 0 60px rgba(232, 53, 160, 0.2);
                }
              }

              .increment-section {
                display: none;
              }

              /* Floating bar - below globe on desktop, bottom on mobile */
              .floating-bar {
                display: flex;
                position: fixed;
                background: rgba(19, 17, 28, 0.95);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(123, 12, 208, 0.4);
                padding: 1rem 1.5rem;
                align-items: center;
                gap: 1.5rem;
                z-index: 100;
                border-radius: 16px;
                animation: pulse-glow 3s ease-in-out infinite;
                justify-content: center;
                /* Desktop: centered below globe */
                bottom: 2rem;
                left: 50%;
                transform: translateX(-50%);
                margin-left: 250px; /* Half of left column width to center in globe area */
                max-width: 400px;
              }

              /* Mobile responsive layout */
              @media (max-width: 900px) {
                .main-layout {
                  grid-template-columns: 1fr;
                  grid-template-rows: auto auto 1fr;
                  min-height: 100dvh;
                  height: 100dvh;
                }
                .content-column {
                  height: auto;
                  max-height: 0;
                  overflow: hidden;
                  border-right: none;
                  border-bottom: none;
                  padding: 0 1.5rem;
                  transition: max-height 0.3s ease, padding 0.3s ease;
                }
                .content-column.expanded {
                  max-height: 550px;
                  padding: 1.5rem;
                  padding-bottom: 2rem;
                  overflow: visible;
                }
                .content-column h1 {
                  font-size: 1.75rem;
                  margin-bottom: 1rem;
                }
                .content-column p {
                  font-size: 0.875rem;
                  margin-bottom: 0.75rem;
                }
                .pull-tab {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 48px;
                  height: 48px;
                  position: fixed;
                  top: 1.5rem;
                  left: 50%;
                  transform: translateX(-50%);
                  background: rgba(19, 17, 28, 0.95);
                  backdrop-filter: blur(10px);
                  -webkit-backdrop-filter: blur(10px);
                  border: 1px solid rgba(123, 12, 208, 0.4);
                  border-radius: 50%;
                  cursor: pointer;
                  animation: pulse-glow 3s ease-in-out infinite;
                  z-index: 100;
                }
                .pull-tab::after {
                  content: '';
                  display: block;
                  width: 10px;
                  height: 10px;
                  border-right: 2px solid rgba(123, 12, 208, 0.8);
                  border-bottom: 2px solid rgba(123, 12, 208, 0.8);
                  transform: rotate(45deg) translateY(-2px);
                  filter: drop-shadow(0 0 6px rgba(123, 12, 208, 0.6));
                  transition: all 0.3s ease;
                }
                .main-layout:has(.content-column.expanded) .pull-tab::after {
                  transform: rotate(-135deg) translateY(-2px);
                }
                .pull-tab:hover::after,
                .pull-tab:active::after {
                  border-color: rgba(232, 53, 160, 0.9);
                  filter: drop-shadow(0 0 10px rgba(232, 53, 160, 0.8));
                }
                .globe-column {
                  flex: 1;
                  min-height: 0;
                  padding-bottom: 100px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  overflow: hidden;
                }
                .globe-column > div {
                  transform: scale(0.75);
                }
                /* Mobile: bottom bar centered */
                .floating-bar {
                  left: 50%;
                  bottom: calc(1rem + env(safe-area-inset-bottom));
                  margin-left: 0;
                  transform: translateX(-50%);
                  max-width: calc(100% - 2rem);
                  width: auto;
                  border-radius: 12px;
                }
              }

              /* Actual phones - smaller screens */
              @media (max-width: 500px) {
                .globe-column {
                  padding-top: 80px;
                }
                .globe-column > div {
                  transform: scale(0.48);
                }
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

      // Send current state including existing connections from Redis
      const regions = Array.from(latestCounts.values());
      const existingConnections = await getAllConnectionsFromRedis();
      const connectedLocations = existingConnections.map(c => ({ lat: c.from.lat, lng: c.from.lng }));

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
        // Remove connection from Redis
        await removeConnectionFromRedis(userData.connection.id);

        // Fetch updated connections from Redis for consistency
        const allConnections = await getAllConnectionsFromRedis();
        const connectedLocations = allConnections.map(c => ({ lat: c.from.lat, lng: c.from.lng }));

        // Broadcast updated user list and connection removal
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
          // Create connection data using consolidated location for display
          const consolidatedLocation = getConsolidatedLocation(REGION);
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
              lat: consolidatedLocation[0],
              lng: consolidatedLocation[1]
            }
          };
          
          // Store both location and connection locally
          connectedUsers.set(ws, {
            location: {
              lat: data.location.lat,
              lng: data.location.lng
            },
            connection
          });

          // Store connection in Redis for cross-replica visibility
          await storeConnectionInRedis(connection);

          // Fetch updated connections from Redis for consistency
          const allConnections = await getAllConnectionsFromRedis();
          const connectedLocations = allConnections.map(c => ({ lat: c.from.lat, lng: c.from.lng }));

          // Prepare updates
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
        
        if (data.type === "increment" && data.location) {
          // Increment counter when user clicks the button
          const newValue = await incrementCounter();
          const updateMessage = {
            type: "update",
            region: REGION,
            count: newValue,
            lastUpdate: new Date().toISOString()
          };
          
          // Broadcast to all clients and Redis
          const messageStr = JSON.stringify(updateMessage);
          await Promise.all([
            // Send to WebSocket clients
            ...Array.from(clients).map(client => 
              client.send(messageStr)
            ),
            // Broadcast to Redis
            ...Array.from(redisClients.values()).map(client => 
              client.publish('counter-updates', messageStr)
            )
          ]);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to Redis instances: ${Array.from(redisClients.keys()).join(", ")}`);