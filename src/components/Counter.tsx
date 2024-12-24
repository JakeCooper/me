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
  const [size, setSize] = React.useState(800);

  // Update size on mount and handle resize
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSize(Math.min(window.innerWidth - 40, 800));

      function handleResize() {
        setSize(Math.min(window.innerWidth - 40, 800));
      }

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  const points = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => {
      const regionData = regions.find(r => r.region === region);
      return {
        lat,
        lng,
        region,
        count: regionData?.count ?? 0,
        radius: region === currentRegion ? 0.8 : 0.5,
        color: region === currentRegion ? "#E835A0" : "#9241D3",
        height: 0.1,
      };
    }),
    [regions, currentRegion]
  );

  const globeMaterial = useMemo(() => {
    const material = new MeshPhongMaterial();
    material.color = new Color("#13111C");
    material.transparent = true;
    material.opacity = 0.8;
    return material;
  }, []);

  useEffect(() => {
    if (!globeEl.current) return;

    globeEl.current.controls().autoRotate = true;
    globeEl.current.controls().enableZoom = false;
    globeEl.current.controls().autoRotateSpeed = 0.5;
    globeEl.current.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });
  }, []);

  // Only render on client side
  if (typeof window === 'undefined') {
    return null;
  }

  // Generate points for the dotted effect
  const hexPoints = [];
  for (let lat = -90; lat <= 90; lat += 3) {
    for (let lng = -180; lng <= 180; lng += 3) {
      hexPoints.push({
        lat,
        lng,
        size: 0.2,
        color: "rgba(146,65,211, 0.1)"
      });
    }
  }

  return (
    <Globe
      ref={globeEl}
      width={size}
      height={size}
      globeMaterial={globeMaterial}
      animateIn={false}
      
      // Dotted globe effect
      hexPolygonsData={hexPoints}
      hexPolygonResolution={3}
      hexPolygonMargin={0.7}
      hexPolygonColor={d => d.color}
      
      // Points for datacenters
      customLayerData={points}
      customThreeObject={d => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ 
            map: new THREE.CanvasTexture((() => {
              const canvas = document.createElement('canvas');
              canvas.width = 128;
              canvas.height = 64;
              const ctx = canvas.getContext('2d')!;
              ctx.fillStyle = d.color;
              ctx.beginPath();
              ctx.arc(32, 32, d.radius * 20, 0, 2 * Math.PI);
              ctx.fill();
              
              // Add count text
              ctx.font = 'bold 24px Arial';
              ctx.fillStyle = 'white';
              ctx.textAlign = 'center';
              ctx.fillText(d.count.toString(), 96, 32);
              return canvas;
            })()),
            transparent: true,
            opacity: 0.8
          })
        );
        sprite.scale.set(d.radius * 20, d.radius * 10, 1);
        return sprite;
      }}
      customThreeObjectUpdate={(obj, d) => {
        Object.assign(obj.position, globeEl.current.getCoords(d.lat, d.lng, d.height));
      }}
      
      // Atmosphere
      atmosphereColor="#1C1539"
      atmosphereAltitude={0.25}
      atmosphereGlowColor="#1C1539"
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