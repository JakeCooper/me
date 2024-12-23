import React from "react";

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface CounterProps {
  regions: RegionData[];
  currentRegion: string;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'No updates yet';
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return 'No updates yet';
    }
    return date.toLocaleString(undefined, {
      timeZone: 'UTC',
      timeZoneName: 'short'
    });
  } catch (e) {
    return 'No updates yet';
  }
}

// Single Counter component for both server and client
export function Counter({ regions, currentRegion }: CounterProps) {
  const [localRegions, setLocalRegions] = React.useState(regions);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [status, setStatus] = React.useState("loading");

  React.useEffect(() => {
    let reconnectTimer: number;
    
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const websocket = new WebSocket(`${protocol}//${window.location.host}`);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
        setStatus("connected");
        setWs(websocket);
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "state" && Array.isArray(data.regions)) {
          setLocalRegions(data.regions);
        }
      };

      websocket.onclose = () => {
        console.log('WebSocket disconnected, attempting to reconnect...');
        setStatus("reconnecting");
        setWs(null);
        clearTimeout(reconnectTimer);
        // Try to reconnect more frequently during deployment (every 2 seconds)
        reconnectTimer = setTimeout(connect, 2000) as unknown as number;
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        websocket.close(); // This will trigger onclose and reconnection
      };
    }

    // Initial connection
    connect();

    // Cleanup function
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const incrementCounter = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "increment" }));
    }
  };

  return (
    <div>
      <h1>Global Counter Network</h1>
      <p>You are connected to: {currentRegion}</p>
      <p>Connection status: {status}</p>
      
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        {localRegions.map((r) => (
          <div 
            key={r.region}
            style={{ 
              padding: '1rem',
              border: r.region === currentRegion ? '2px solid blue' : '1px solid gray',
              borderRadius: '4px'
            }}
          >
            <h3>{r.region}</h3>
            {r.region === currentRegion ? (
              <button
                onClick={incrementCounter}
                disabled={!ws || ws.readyState !== WebSocket.OPEN}
                style={{
                  padding: '8px 16px',
                  fontSize: '16px',
                  cursor: ws && ws.readyState === WebSocket.OPEN ? 'pointer' : 'not-allowed'
                }}
              >
                Count: {r.count}
              </button>
            ) : (
              <div>Count: {r.count}</div>
            )}
            <div style={{ fontSize: '0.8em', color: '#666' }}>
              Last update: {formatDate(r.lastUpdate)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}