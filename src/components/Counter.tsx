import React, { useEffect, useRef, useMemo } from "react";
import { Color, MeshPhongMaterial } from "three";
import * as THREE from 'three';
import * as topojson from 'topojson-client';
import world from './world.json';

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

let Globe: any = () => null;
if (typeof window !== "undefined") {
  Globe = require("react-globe.gl").default;
}

function GlobeViz({ regions, currentRegion }: CounterProps) {
  const globeEl = useRef<any>();
  const [ready, setReady] = React.useState(false);

  // Generate hex points for the grid effect
  const hexData = useMemo(() => {
    const data = [];
    for (let lat = -90; lat <= 90; lat += 2) {
      for (let lng = -180; lng <= 180; lng += 2) {
        data.push([lng, lat]);
      }
    }
    return data;
  }, []);

  // Setup points data
  const pointsData = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => ({
      lat,
      lng,
      size: region === currentRegion ? 1.5 : 1,
      color: region === currentRegion ? "#E835A0" : "#9241D3",
      label: `${region}: ${regions.find(r => r.region === region)?.count ?? 0}`
    })),
    [regions, currentRegion]
  );

  useEffect(() => {
    let Globe = null;
    if (typeof window !== 'undefined') {
      Globe = require('react-globe.gl').default;
      setReady(true);
    }
  }, []);

  if (!ready || typeof window === 'undefined') {
    return null;
  }

  const Globe = require('react-globe.gl').default;
  return (
    <Globe
      ref={globeEl}
      width={800}
      height={800}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
      
      pointsData={pointsData}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointLabel="label"
      pointRadius="size"
      
      backgroundColor="#13111C"
      atmosphereColor="#1C1539"
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