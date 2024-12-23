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

// Datacenter coordinates on the map
const DATACENTER_LOCATIONS = {
  'us-west1': { x: 100, y: 180, label: "US West (Oregon)" },      // Oregon
  'us-east4': { x: 200, y: 180, label: "US East (Virginia)" },    // Virginia
  'europe-west4': { x: 420, y: 150, label: "Europe West" },       // Netherlands
  'asia-southeast1': { x: 680, y: 250, label: "Asia Southeast" }  // Singapore
};

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
        reconnectTimer = setTimeout(connect, 2000) as unknown as number;
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        websocket.close();
      };
    }

    connect();

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
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        marginBottom: '2rem',
        padding: '1rem',
        backgroundColor: '#f0f0f0',
        borderRadius: '8px'
      }}>
        <div>
          <strong>Your Region ({currentRegion}):</strong> {localRegions.find(r => r.region === currentRegion)?.count ?? 0}
        </div>
        <button
          onClick={incrementCounter}
          disabled={!ws || ws.readyState !== WebSocket.OPEN}
          style={{
            padding: '8px 16px',
            fontSize: '16px',
            cursor: ws && ws.readyState === WebSocket.OPEN ? 'pointer' : 'not-allowed',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Increment Counter
        </button>
        <div style={{ marginLeft: 'auto', color: '#666' }}>
          Status: {status}
        </div>
      </div>

      {/* Globe Visualization */}
      <div style={{ marginBottom: '2rem' }}>
        <svg width="800" height="400" viewBox="0 0 800 400" style={{ backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          {/* Simple world map outline - simplified continents */}
          <path
            d="M50,200 C100,150 200,150 300,200 C400,250 500,250 600,200 C700,150 750,150 750,200"
            fill="none"
            stroke="#ddd"
            strokeWidth="100"
            opacity="0.3"
          />
          
          {/* Datacenters */}
          {Object.entries(DATACENTER_LOCATIONS).map(([region, loc]) => {
            const regionData = localRegions.find(r => r.region === region);
            const isCurrentRegion = region === currentRegion;
            return (
              <g key={region}>
                {/* Pulse animation for current region */}
                {isCurrentRegion && (
                  <circle
                    cx={loc.x}
                    cy={loc.y}
                    r="20"
                    fill="rgba(0, 123, 255, 0.2)"
                    style={{
                      animation: 'pulse 2s infinite'
                    }}
                  >
                    <animate
                      attributeName="r"
                      values="20;30;20"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.2;0;0.2"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                
                {/* Datacenter point */}
                <circle
                  cx={loc.x}
                  cy={loc.y}
                  r="6"
                  fill={isCurrentRegion ? "#007bff" : "#666"}
                />
                
                {/* Counter value */}
                <text
                  x={loc.x}
                  y={loc.y - 20}
                  textAnchor="middle"
                  fill="#333"
                  fontSize="14"
                  fontWeight="bold"
                >
                  {regionData?.count ?? 0}
                </text>
                
                {/* Region label */}
                <text
                  x={loc.x}
                  y={loc.y + 20}
                  textAnchor="middle"
                  fill="#666"
                  fontSize="12"
                >
                  {loc.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Region cards */}
      <div style={{ display: 'grid', gap: '1rem' }}>
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
            <div style={{ fontSize: '1.2em', marginBottom: '0.5rem' }}>
              Count: {r.count}
            </div>
            <div style={{ fontSize: '0.8em', color: '#666' }}>
              Last update: {formatDate(r.lastUpdate)}
            </div>
          </div>
        ))}
      </div>

      <style>
        {`
          @keyframes pulse {
            0% { transform: scale(1); opacity: 0.2; }
            50% { transform: scale(1.5); opacity: 0; }
            100% { transform: scale(1); opacity: 0.2; }
          }
        `}
      </style>
    </div>
  );
}