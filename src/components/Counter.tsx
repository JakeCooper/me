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
  const rotationTimer = useRef<number>();

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
    const material = new MeshPhongMaterial({
      color: new Color("#13111C"),
      transparent: true,
      opacity: 0.8,
      wireframe: true,
      wireframeLinewidth: 0.1
    });
    return material;
  }, []);

  useEffect(() => {
    if (!globeEl.current) return;

    // Initial camera position
    globeEl.current.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });
    
    // Setup continuous rotation
    let currentRotation = 0;
    const animate = () => {
      if (globeEl.current) {
        currentRotation += 0.5;
        globeEl.current.rotation({ lat: 30, lng: currentRotation });
        rotationTimer.current = requestAnimationFrame(animate);
      }
    };
    
    animate();

    return () => {
      if (rotationTimer.current) {
        cancelAnimationFrame(rotationTimer.current);
      }
    };
  }, []);

  // Only render on client side
  if (typeof window === 'undefined') {
    return null;
  }

  // Generate grid dots
  const gridDots = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lng = -180; lng <= 180; lng += 30) {
      gridDots.push({
        lat,
        lng,
        size: 0.15,
        color: "rgba(146,65,211, 0.3)"
      });
    }
  }

  // Generate lat/long lines
  const gridLines = [];
  // Latitude lines
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = [];
    for (let lng = -180; lng <= 180; lng += 5) {
      points.push([lng, lat]);
    }
    gridLines.push({
      coords: points,
      color: "rgba(146,65,211, 0.2)",
      lineWidth: 0.5
    });
  }
  // Longitude lines
  for (let lng = -180; lng <= 180; lng += 30) {
    const points = [];
    for (let lat = -60; lat <= 60; lat += 5) {
      points.push([lng, lat]);
    }
    gridLines.push({
      coords: points,
      color: "rgba(146,65,211, 0.2)",
      lineWidth: 0.5
    });
  }

  return (
    <Globe
      ref={globeEl}
      width={size}
      height={size}
      globeMaterial={globeMaterial}
      animateIn={false}

      // Grid lines
      customLayerData={gridLines}
      customThreeObject={d => {
        const points = d.coords.map(([lng, lat]) => 
          globeEl.current.getCoords(lat, lng, 1.02)
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: d.color,
          linewidth: d.lineWidth,
          transparent: true
        });
        return new THREE.Line(geometry, material);
      }}
      
      // Points for datacenters
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor={d => d.color}
      pointAltitude={0.01}
      pointRadius={d => d.radius}
      pointLabel={d => `${d.region}: ${d.count}`}
      
      // Grid dots
      hexPolygonsData={gridDots}
      hexPolygonColor={d => d.color}
      hexPolygonMargin={1}
      hexPolygonCurvatureResolution={4}
      hexPolygonResolution={3}
      
      // Atmosphere
      atmosphereColor="#1C1539"
      atmosphereAltitude={0.25}
      atmosphereGlowColor="#1C1539"
      backgroundColor="#13111C"

      // Disable auto-rotate as we're handling it ourselves
      enablePointerInteraction={false}
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