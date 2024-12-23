import React from "react";
import { renderToString } from "react-dom/server";
import { Counter } from "./components/Counter";
import { WebSocket as WSClient } from "ws";

// Types
interface RegionState {
  count: number;
  lastUpdate: string;
}

// Shared state
const regions = new Map<string, RegionState>();
const clients = new Set<WebSocket>();
const peerConnections = new Map<string, WSClient>();

const REGION = process.env.RAILWAY_REPLICA_REGION || "unknown-region";

// Update the PEERS definition and initialization in server.tsx
const REGIONS = {
  "us-west2": "ws://us-west.railway.internal:3000",
  "us-east1": "ws://us-east.railway.internal:3000"
};

// Initialize all known regions with 0 counts
Object.keys(REGIONS).forEach(region => {
  if (!regions.has(region)) {
    regions.set(region, { 
      count: 0, 
      lastUpdate: new Date().toISOString() // Use ISO string format
    });
  }
});

// Filter out our own region from the peers list
const PEER_URLS = Object.entries(REGIONS)
  .filter(([region]) => region !== REGION)
  .map(([_, url]) => url);


// Initialize our region
regions.set(REGION, { count: 0, lastUpdate: Date.now().toLocaleString() });

// Function to broadcast current state to all WebSocket clients
function broadcastToClients() {
  const state = Array.from(regions.entries()).map(([region, data]) => ({
    region,
    count: data.count,
    lastUpdate: data.lastUpdate
  }));
  
  const message = JSON.stringify({ type: "state", regions: state });
  clients.forEach(client => client.send(message));
}

// Function to connect to a peer region
function connectToPeer(peerUrl: string) {
  if (peerConnections.has(peerUrl)) {
    return; // Already connected
  }

  console.log(`[${REGION}] Attempting to connect to peer: ${peerUrl}`);
  const ws = new WSClient(peerUrl);
  peerConnections.set(peerUrl, ws);

  ws.on('error', (error) => {
    console.error(`[${REGION}] Error connecting to peer ${peerUrl}:`, error.message);
    peerConnections.delete(peerUrl);
  });

  ws.on('open', () => {
    console.log(`[${REGION}] Connected to peer: ${peerUrl}`);
    // Request current state
    ws.send(JSON.stringify({ type: "sync_request" }));
  });

  ws.on('message', (data) => {
    try {
      console.log(`[${REGION}] Received message from ${peerUrl}:`, data.toString().slice(0, 100) + '...');
      const message = JSON.parse(data.toString());
      if (message.type === "sync" || message.type === "update") {
        const { region, count, lastUpdate } = message;
        const current = regions.get(region);
        if (!current || current.lastUpdate < lastUpdate) {
          regions.set(region, { count, lastUpdate });
          // Broadcast to all clients
          broadcastToClients();
        }
      } else if (message.type === "sync_request") {
        // Send our entire state
        const state = Array.from(regions.entries()).map(([region, data]) => ({
          type: "sync",
          region,
          count: data.count,
          lastUpdate: data.lastUpdate
        }));
        ws.send(JSON.stringify(state));
      }
    } catch (e) {
      console.error(`[${REGION}] Error processing peer message:`, e);
    }
  });

  ws.on('close', () => {
    console.log(`[${REGION}] Disconnected from peer: ${peerUrl}`);
    peerConnections.delete(peerUrl);
    // Try to reconnect after a delay
    setTimeout(() => connectToPeer(peerUrl), 5000);
  });
}

// Connect to all peers
PEER_URLS.forEach(connectToPeer);

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

    // Get all regions for initial state
    const initialRegions = Array.from(regions.entries()).map(([region, data]) => ({
      region,
      count: data.count,
      lastUpdate: data.lastUpdate
    }));

    // Server-side render
    const content = renderToString(<Counter regions={initialRegions} currentRegion={REGION} />);
    
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
                regions: ${JSON.stringify(initialRegions)},
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
      // Send current state to new client
      broadcastToClients();
    },
    close(ws) {
      clients.delete(ws);
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "increment") {
          const region = regions.get(REGION)!;
          region.count++;
          region.lastUpdate = new Date().toISOString();
          regions.set(REGION, region);
          
          // Broadcast to all clients
          broadcastToClients();
          
          // Broadcast to all peers using persistent connections
          const update = JSON.stringify({
            type: "update",
            region: REGION,
            count: region.count,
            lastUpdate: region.lastUpdate
          });
          
          // Send to all connected peers
          peerConnections.forEach((peerWs, url) => {
            if (peerWs.readyState === peerWs.OPEN) {
              peerWs.send(update);
            } else {
              console.log(`[${REGION}] Peer connection to ${url} not ready, reconnecting...`);
              peerConnections.delete(url);
              connectToPeer(url);
            }
          });
        }
      } catch (e) {
        console.error("Error processing message:", e);
      }
    },
  },
});

console.log(`Server running at http://localhost:${server.port} (${REGION})`);
console.log(`Connected to peers: ${PEER_URLS.join(", ") || "none"}`);