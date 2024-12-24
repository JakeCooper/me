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

const GlobeViz = ({ regions, currentRegion, connections = [], userLocation }: CounterProps & { connections: Connection[], userLocation: { lat: number, lng: number } | null }) => {
  const globeEl = useRef<any>();

  // Setup points data with labels
  const datacenterPoints = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => {
      const regionData = regions.find(r => r.region === region);
      return {
        lat,
        lng,
        size: region === currentRegion ? 1.5 : 1,
        color: region === currentRegion ? "#E835A0" : "#9241D3",
        region,
        count: regionData?.count ?? 0,
        type: 'datacenter'
      };
    }),
    [regions, currentRegion]
  );

  const userPoint = useMemo(() =>
    userLocation ? {
      lat: userLocation.lat,
      lng: userLocation.lng,
      size: 1,
      color: 'green',
      type: 'user'
    } : null,
    [userLocation]
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
      color: conn.to.region === currentRegion ? "#E835A0" : "#9241D3"
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
        
        customLayerData={[...datacenterPoints, ...(userPoint ? [userPoint] : [])]}
        customThreeObject={d => {
          const group = new THREE.Group();
        
          const point = new THREE.Mesh(
            new THREE.SphereGeometry(d.size, 16, 16),
            new THREE.MeshBasicMaterial({ color: d.color })
          );
          group.add(point);
        
          if (d.type === 'datacenter') {
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
          }
        
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
        arcColor="color"
        arcDashLength={0.5}
        arcDashGap={0.1}
        arcDashAnimateTime={2000}
        arcStroke={1}
        arcAltitudeAutoScale={1}
        
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
  
        // Send "connected" message to server
        websocket.send(JSON.stringify({
          type: "connected",
          location: userLocation,
        }));
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "state" && Array.isArray(data.regions)) {
          setLocalRegions(data.regions);
        }
        if (data.type === "update") {
          if (data.region) {
            setLocalRegions(prevRegions =>
              prevRegions.map(region =>
                region.region === data.region
                  ? { ...region, count: data.count, lastUpdate: data.lastUpdate }
                  : region
              )
            );
          }
          if (data.connection) {
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
        }
        if (data.type === "connected") {
          if (data.region) {
            setLocalRegions(prevRegions =>
              prevRegions.map(region =>
                region.region === data.region
                  ? { ...region, count: data.count, lastUpdate: data.lastUpdate }
                  : region
              )
            );
          }
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
  }, [userLocation]);

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
    <div className="min-h-screen bg-[#13111C] text-white p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Bio */}
        <div className="space-y-6 pr-8">
          <h1 className="text-4xl font-bold mb-6">Hello</h1>
          
          <div className="space-y-4 text-lg leading-relaxed">
            <p>
              My name is Jake Cooper. I'm a technologist originally from Canada.
            </p>
            
            <p>
              I currently live in San Francisco, where I run{" "}
              <a href="https://railway.app" className="text-[#E835A0] hover:underline">
                Railway.com
              </a>
              , an infrastructure startup. We're remote, employing 25+ around the world, 
              from California to Japan and everywhere in between.
            </p>
            
            <p>
              You can deploy anything on Railway, including this website.
            </p>
            
            <p className="font-mono text-sm opacity-75">
              It's served via IP address 66.33.22.11 (<strong>φ^-1</strong>), 
              by ASN 400940, and runs in {regions.length} different locations, 
              across 3 different countries, on servers we own.
            </p>
            
            <p className="italic">
              All requests to this website can be seen in real-time to your right.
            </p>
          </div>
        </div>

        {/* Right Column - Globe */}
        <div>
          <div className="rounded-lg bg-black/30 backdrop-blur border border-white/10">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <strong>Your Region ({currentRegion}):</strong>{" "}
                {localRegions.find(r => r.region === currentRegion)?.count ?? 0}
              </div>
              <button
                onClick={incrementCounter}
                disabled={!ws || ws.readyState !== WebSocket.OPEN || !userLocation}
                className="px-4 py-2 bg-[#E835A0] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Increment Counter
              </button>
              <div className="text-sm opacity-50">
                Status: {status}
              </div>
            </div>

            <div className="flex justify-center">
              <GlobeViz 
                regions={localRegions} 
                currentRegion={currentRegion} 
                connections={connections} 
                userLocation={userLocation}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}