import React, { useEffect, useRef, useMemo, useState } from "react";
import { Color, MeshPhongMaterial } from "three";
import * as THREE from 'three';
import * as topojson from 'topojson-client';
import world from './world.json';
import type { GlobeProps } from "react-globe.gl";
import { countries } from "./countries";

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface CounterProps {
  regions: RegionData[];
  currentRegion: string;
}

interface GlobeStyles {
  opacity: number;
  shininess: number;
  emissive: Color;
  emissiveIntensity: number;
  atmosphereColor: string;
  pointColor: string;
  hexPolygonColor: string;
  backgroundColor: string;
  atmosphereAltitude: number;
}

const globeStyles: Record<"light" | "dark", GlobeStyles> = {
  dark: {
    opacity: 0.5,
    shininess: 1.25,
    pointColor: "#E835A0",
    emissive: new Color("#ffffff"),
    emissiveIntensity: 2,
    atmosphereColor: "#1C1539",
    backgroundColor: "#13111C",
    hexPolygonColor: "rgba(146,65,211, 0.5)",
    atmosphereAltitude: 0.25,
  },
  light: {
    opacity: 1,
    shininess: 0,
    emissive: new Color("#ffffff"),
    emissiveIntensity: 2,
    pointColor: "#E935A1",
    atmosphereColor: "#DDA7FF",
    atmosphereAltitude: 0.175,
    backgroundColor: "#ffffff",
    hexPolygonColor: "rgba(250, 45, 225, .65)",
  },
};

let ReactGlobe: React.FC<GlobeProps & { ref: any }> = () => null;

const MAP_CENTER = { lat: 30.773972, lng: -100.561668, altitude: 1.68 };

// Data center coordinates [lat, lng]
const DATACENTER_LOCATIONS = {
  'us-west1': [45.5945, -122.1562],    // Oregon
  'us-east4': [38.7223, -77.0196],     // Virginia
  'europe-west4': [53.4478, 6.8367],   // Netherlands
  'asia-southeast1': [1.3521, 103.8198] // Singapore
};

if (typeof window !== 'undefined') {
  ReactGlobe = require('react-globe.gl').default;
}

const useGeolocation = () => {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    const success = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setLocation({ lat: latitude, lng: longitude });
    };

    const fail = (err: GeolocationPositionError) => {
      setError(`Unable to retrieve your location (${err.message})`);
    };

    navigator.geolocation.getCurrentPosition(success, fail);
  }, []);

  return { location, error };
};

const GlobeViz = ({ regions, currentRegion }: CounterProps) => {
  const globeEl = useRef<any>();

  const { location: userLocation, error } = useGeolocation();

  console.log(userLocation, error);

  // Setup points data
  const pointsData = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => ({
      lat,
      lng,
      size: region === currentRegion ? 1.0 : 0.5,
      color: region === currentRegion ? "#E835A0" : "#9241D3",
      label: `${region}: ${regions.find(r => r.region === region)?.count ?? 0}`
    })),
    [regions, currentRegion]
  );

  const styles: GlobeStyles = useMemo(
    () => globeStyles["dark"],
    [],
  ); // TODO: Support darkmode switch

  const globeMaterial = useMemo(() => {
    const globeMaterial = new MeshPhongMaterial();
    globeMaterial.color = new Color("#13111C");

    globeMaterial.transparent = true;
    globeMaterial.flatShading = true;
    globeMaterial.opacity = styles.opacity;
    globeMaterial.shininess = styles.shininess;
    globeMaterial.emissive = styles.emissive;
    globeMaterial.emissiveIntensity = styles.emissiveIntensity;
    return globeMaterial;
  }, [])

  // Auto-rotate
  useEffect(() => {
    const globe = globeEl.current;
    if (globe == null) return;

    globeEl.current.pointOfView(MAP_CENTER, 0);
    
    globeEl.current.controls().autoRotate = true;
    globeEl.current.controls().enableZoom = false;
    globeEl.current.controls().autoRotateSpeed = -0.5;
  }, []);

  return (
    <div style={{ 
      background: 'radial-gradient(circle at center, #13111C 0%, #090818 100%)',
      padding: '2rem',
      borderRadius: '8px'
    }}>
      <ReactGlobe
        ref={globeEl}
        width={800}
        height={800}
        // globeImageUrl="//unpkg.com/three-globe/example/img/earth-water.png"
        // bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        
        pointsData={pointsData}
        pointAltitude={0.01}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointLabel="label"
        pointRadius="size"

        globeMaterial={globeMaterial}
        
        backgroundColor={styles.backgroundColor}
        atmosphereColor={styles.atmosphereColor}
        atmosphereAltitude={styles.atmosphereAltitude}

        hexPolygonAltitude={0.01}
        hexPolygonsData={countries.features}
        hexPolygonColor={() => styles.hexPolygonColor} // Full opacity
        hexPolygonResolution={3}
        hexPolygonUseDots={true}
        hexPolygonMargin={0.7}
      />
    </div>
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