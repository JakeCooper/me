import React, { useEffect, useRef, useMemo } from "react";
import { Color, MeshPhongMaterial } from "three";
import * as THREE from 'three';
import { countries } from "./countries";

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface Connection {
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

let ReactGlobe: React.FC<any> = () => null;

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

const GlobeViz = ({ regions, currentRegion, connections = [] }: CounterProps & { connections: Connection[] }) => {
  const globeEl = useRef<any>();

  // Setup points data with labels
  const pointsData = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => {
      const regionData = regions.find(r => r.region === region);
      return {
        lat,
        lng,
        size: region === currentRegion ? 1.5 : 1,
        color: region === currentRegion ? "#E835A0" : "#9241D3",
        region,
        count: regionData?.count ?? 0
      };
    }),
    [regions, currentRegion]
  );

  const styles: GlobeStyles = useMemo(
    () => globeStyles["dark"],
    [],
  );

  // Setup arcs data
  const arcData = useMemo(() => 
    connections.map(conn => ({
      startLat: conn.from.lat,
      startLng: conn.from.lng,
      endLat: conn.to.lat,
      endLng: conn.to.lng,
      color: conn.to.region === currentRegion ? "#E835A0" : "#9241D3",
      arcAltitude: 0.2, // Higher for longer arcs, lower for shorter ones
    })),
    [connections, currentRegion]
  );

  // Auto-rotate
  useEffect(() => {
    const globe = globeEl.current;
    if (globe == null) return;

    globe.pointOfView(MAP_CENTER, 0);
    globe.controls().autoRotate = true;
    globe.controls().enableZoom = false;
    globe.controls().autoRotateSpeed = -0.5;
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
        
        customLayerData={pointsData}
        customThreeObject={d => {
          const group = new THREE.Group();

          const point = new THREE.Mesh(
            new THREE.SphereGeometry(d.size, 16, 16),
            new THREE.MeshBasicMaterial({ color: d.color })
          );
          group.add(point);

          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 64;
          const ctx = canvas.getContext('2d')!;
          
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
          ctx.fill();
          
          ctx.fillStyle = 'white';
          ctx.font = 'bold 32px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(d.count.toString(), canvas.width/2, canvas.height/2);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMaterial = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
          });
          const label = new THREE.Sprite(spriteMaterial);
          label.scale.set(10, 5, 1);
          label.position.y = 10;
          group.add(label);

          return group;
        }}
        customThreeObjectUpdate={(obj, d) => {
          if (!obj || !globeEl.current) return;
          
          const pos = globeEl.current.getCoords(d.lat, d.lng, 0.01);
          obj.position.set(pos.x, pos.y, pos.z);
          
          const label = obj.children[1];
          if (label) {
            const spriteMaterial = label.material as THREE.SpriteMaterial;
            const canvas = spriteMaterial.map!.source.data as HTMLCanvasElement;
            const ctx = canvas.getContext('2d')!;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.count.toString(), canvas.width/2, canvas.height/2);
            
            spriteMaterial.map!.needsUpdate = true;
          }

          obj.quaternion.copy(globeEl.current.camera().quaternion);
        }}
        
        arcsData={arcData}
        arcColor="color"                  // Color property for each arc
        arcDashLength={0.3}              // Shorter visible segment for a cleaner animation
        arcDashGap={0.7}                 // Longer gap to give the appearance of travel
        arcDashInitialGap={0.1}             // Ensures the arc starts from origin
        arcDashAnimateTime={2000}         // Animation duration in milliseconds
        arcStroke={1.5}                   // Slightly thicker stroke for visibility
        arcAltitudeAutoScale={0.5}        // Makes arcs proportional to distance
        // arcAltitude={(d) => 0.2}          // Optional: Fixed altitude for uniform appearance
        
        backgroundColor={styles.backgroundColor}
        atmosphereColor={styles.atmosphereColor}
        atmosphereAltitude={styles.atmosphereAltitude}

        hexPolygonsData={countries.features}
        hexPolygonColor={() => styles.hexPolygonColor}
        hexPolygonResolution={3}
        hexPolygonUseDots={true}
        hexPolygonMargin={0.7}
      />
    </div>
  );
}

export function Counter({ regions, currentRegion }: CounterProps) {
  const [localRegions, setLocalRegions] = React.useState(regions);
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [status, setStatus] = React.useState("loading");
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);

  // Get user location when component mounts
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          // Fallback to datacenter location
          setUserLocation({
            lat: DATACENTER_LOCATIONS[currentRegion][0],
            lng: DATACENTER_LOCATIONS[currentRegion][1]
          });
        }
      );
    }
  }, [currentRegion]);

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
        if (data.type === "update" && data.connection) {
          // Add new connection with fade-out
          setConnections(prev => [...prev, data.connection]);
          // Remove connection after animation
          setTimeout(() => {
            setConnections(prev => 
              prev.filter(c => 
                c.from.lat !== data.connection.from.lat || 
                c.from.lng !== data.connection.from.lng
              )
            );
          }, 2000);
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
    if (ws?.readyState === WebSocket.OPEN && userLocation) {
      // Send increment message to WebSocket
      ws.send(JSON.stringify({ 
        type: "increment",
        location: userLocation
      }));
  
      // Optimistically update the counter in local state
      setLocalRegions((prevRegions) => 
        prevRegions.map(region => 
          region.region === currentRegion 
            ? { ...region, count: region.count + 1 } 
            : region
        )
      );
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
          disabled={!ws || ws.readyState !== WebSocket.OPEN || !userLocation}
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
        <GlobeViz 
          regions={localRegions} 
          currentRegion={currentRegion} 
          connections={connections} 
        />
      </div>
    </div>
  );
}