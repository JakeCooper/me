// At the top of Counter.tsx
import countries from '../countries.json';
import React, { useEffect, useRef, useMemo } from "react";
import { Color, MeshPhongMaterial } from "three";

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface CounterProps {
  regions: RegionData[];
  currentRegion: string;
}

// Data center coordinates [lat, lng]
const DATACENTER_LOCATIONS = {
  'us-west1': [45.5945, -122.1562],    // Oregon
  'us-east4': [38.7223, -77.0196],     // Virginia
  'europe-west4': [53.4478, 6.8367],   // Netherlands
  'asia-southeast1': [1.3521, 103.8198] // Singapore
};

const globeStyles = {
  dark: {
    opacity: 0.5,
    shininess: 1.25,
    pointColor: "#E835A0",
    atmosphereColor: "#1C1539",
    backgroundColor: "#13111C",
    hexPolygonColor: "rgba(146,65,211, 0.5)",
    atmosphereAltitude: 0.25,
  }
};

let Globe: any = () => null;
if (typeof window !== "undefined") {
  Globe = require("react-globe.gl").default;
}

function GlobeViz({ regions, currentRegion }: CounterProps) {
  const globeEl = useRef<any>();
  const size = 600; // Fixed size or make responsive as needed

  const points = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => ({
      lat,
      lng,
      region,
      count: regions.find(r => r.region === region)?.count ?? 0
    })),
    [regions]
  );

  const globeMaterial = useMemo(() => {
    const material = new MeshPhongMaterial();
    material.color = new Color("#13111C");
    material.transparent = true;
    material.opacity = 0.5;
    material.shininess = 1.25;
    return material;
  }, []);

  useEffect(() => {
    if (!globeEl.current) return;

    globeEl.current.controls().autoRotate = true;
    globeEl.current.controls().enableZoom = false;
    globeEl.current.controls().autoRotateSpeed = 0.5;
  }, []);

  return (
    <Globe
      ref={globeEl}
      width={size}
      height={size}
      globeMaterial={globeMaterial}
      animateIn={false}
      
      // Points configuration
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor={d => d.region === currentRegion ? "#E835A0" : "#9241D3"}
      pointAltitude={0.01}
      pointRadius={0.625}
      pointLabel={d => `${d.region}: ${d.count}`}
      
      // Hex polygons for the dotted effect
      hexPolygonsData={countries.features}
      hexPolygonColor={() => "rgba(146,65,211, 0.5)"}
      hexPolygonResolution={3}
      hexPolygonMargin={0.675}
      
      // Atmosphere
      showAtmosphere={true}
      atmosphereColor="#1C1539"
      atmosphereAltitude={0.25}
      backgroundColor="#13111C"
    />
  );
}

export function Counter({ regions, currentRegion }: CounterProps) {
  const [localRegions, setLocalRegions] = React.useState(regions);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [status, setStatus] = React.useState("loading");

  useEffect(() => {
    let reconnectTimer: number;
    
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const websocket = new WebSocket(`${protocol}//${window.location.host}`);
      
      websocket.onopen = () => {
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
        setStatus("reconnecting");
        setWs(null);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000) as unknown as number;
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        websocket.close();
      };

      return websocket;
    }

    const ws = connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws.close();
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
        backgroundColor: '#13111C',
        borderRadius: '8px',
        color: 'white'
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
            backgroundColor: '#E835A0',
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

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <GlobeViz regions={localRegions} currentRegion={currentRegion} />
      </div>
    </div>
  );
}