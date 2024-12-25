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
    hexPolygonColor: "rgba(22, 186, 166, 0.7)",
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

let ReactGlobe: React.FC<any> = () => (
  <div style={{ 
    width: "800px", 
    height: "800px",
    background: "#13111C",
    transition: "opacity 0.3s ease-in-out",
    opacity: 0 
  }} />
);

const MAP_CENTER = { lat: 30.773972, lng: -100.561668, altitude: 1.68 };

// Data center coordinates [lat, lng]
const DATACENTER_LOCATIONS = {
  'us-west1': [45.5945, -122.1562],    // Oregon
  'us-east4': [38.7223, -77.0196],     // Virginia
  'europe-west4': [53.4478, 6.8367],   // Netherlands
  'asia-southeast1': [1.3521, 103.8198] // Singapore
};

if (typeof window !== 'undefined') {
  // Pre-import the module to reduce flash
  const globe = require('react-globe.gl').default;
  ReactGlobe = globe;
}

const GlobeViz = ({ regions, currentRegion, connections = [], userLocation }: CounterProps & { connections: Connection[], userLocation: { lat: number, lng: number } | null }) => {
  const globeEl = useRef<any>();
  const [isLoaded, setIsLoaded] = React.useState(false);

  useEffect(() => {
    if (globeEl.current) {
      setIsLoaded(true);
    }
  }, [globeEl.current]);

  useEffect(() => {
    // Only render globe once it's loaded
    if (typeof window !== 'undefined' && globeEl.current) {
      console.log('Globe is ready, settings:', {
        datacenterPoints,
        currentRegion
      });
    }
  }, [globeEl.current]);

  // Setup points data with labels
  const datacenterPoints = useMemo(() => 
    Object.entries(DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => {
      const regionData = regions.find(r => r.region === region);
      return {
        lat,
        lng,
        size: region === currentRegion ? 1.5 : 1,
        color: region === currentRegion ? '#5CC5B9' : "#9241D3",
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
    connections.map(conn => {
      // Calculate distance between points using the Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = (conn.to.lat - conn.from.lat) * Math.PI / 180;
      const dLon = (conn.to.lng - conn.from.lng) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(conn.from.lat * Math.PI / 180) * Math.cos(conn.to.lat * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
    
      // Base speed in milliseconds per 1000km
      const SPEED = 500; // Adjust this value to make animation faster/slower
      
      return {
        startLat: conn.from.lat,
        startLng: conn.from.lng,
        endLat: conn.to.lat,
        endLng: conn.to.lng,
        color: conn.to.region === currentRegion ? "#5CC5B9" : "#9241D3",
        dashLength: 0.1,
        dashGap: 1,
        dashInitialGap: 0,
        altitude: 0.1,
        // Animation time based on distance
        animationTime: Math.max(1000, distance * SPEED / 1000)
      };
    }),
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
      background: '#13111C',
      transition: 'opacity 0.3s ease-in-out',
      opacity: isLoaded ? 1 : 0
    }}>
      <ReactGlobe
        ref={globeEl}
        width={800}
        height={800}
        
        customLayerData={[...datacenterPoints, ...(userPoint ? [userPoint] : [])]}
        customThreeObject={d => {
          console.log('Creating point with data:', d); // Debug log
          const group = new THREE.Group();
          
          // Create base mesh
          const geometry = new THREE.SphereGeometry(1, 16, 16); // Base size of 1
          const material = new THREE.MeshBasicMaterial();
          const point = new THREE.Mesh(geometry, material);
          
          // Scale the mesh instead of changing geometry
          point.scale.setScalar(d.type === 'datacenter' ? 
            (d.region === currentRegion ? 1.5 : 1) : 1);
          
          // Update material color
          material.color.set(d.color);
          
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
        arcColor={'color'}
        arcAltitude={'altitude'}
        arcStroke={1.5}
        arcDashLength={'dashLength'}
        arcDashGap={'dashGap'}
        arcDashAnimateTime={d => d.animationTime}
        arcCurveType="great-circle"
        arcCurveResolution={64}
        
        backgroundColor={styles.backgroundColor}
        atmosphereColor={styles.atmosphereColor}
        atmosphereAltitude={0.1}

        hexPolygonsData={countries.features}
        hexPolygonColor={() => styles.hexPolygonColor}
        hexPolygonResolution={3}
        hexPolygonUseDots={true}
        hexPolygonMargin={0.7}
        
        showGlobe={true}
        showAtmosphere={false}
        globeMaterial={
          new THREE.MeshPhongMaterial({
            color: '#13111C',
            transparent: true,
            opacity: 0.95,
            shininess: 0.2
          })
        }
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
  const initialConnection = React.useRef(true);

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
    let isConnecting = false;
    
    function connect() {
      if (isConnecting) return;
      isConnecting = true;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const websocket = new WebSocket(`${protocol}//${window.location.host}`);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
        setStatus("connected");
        setWs(websocket);
        isConnecting = false;
        initialConnection.current = false;
  
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
            setConnections(prev => [...prev, data.connection]);
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
      };

      websocket.onclose = () => {
        if (!initialConnection.current) {
          console.log('WebSocket disconnected, attempting to reconnect...');
          setStatus("reconnecting");
        }
        setWs(null);
        isConnecting = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000) as unknown as number;
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (!initialConnection.current) {
          websocket.close();
        }
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
    <div style={{ 
      display: 'grid',
      gridTemplateColumns: '500px 1fr',
      minHeight: '100vh',
      background: '#13111C',
      color: 'white',
      margin: 0,
      padding: 0,
      width: '100vw',
      position: 'absolute',
      left: 0,
      top: 0
    }}>
      {/* Left Column - Content */}
      <div style={{ 
        padding: '2rem',
        height: '100vh',
        overflowY: 'auto'
      }}>
        <h1 style={{ 
          fontSize: '2.5rem', 
          fontWeight: 'bold', 
          marginBottom: '1.5rem',
          marginTop: 0
        }}>
          Hello
        </h1>
        
        <p style={{ 
          marginBottom: '1rem',
          fontSize: '1rem',
          lineHeight: '1.5'
        }}>
          My name is Jake Cooper. I'm a technologist originally from Canada.
        </p>
        
        <p style={{ marginBottom: '1rem', lineHeight: '1.5' }}>
          I currently live in San Francisco, where I run{" "}
          <a 
            href="https://railway.com"
            style={{ color: '#E835A0', textDecoration: 'none' }}
          >
            Railway.com
          </a>
          , an infrastructure startup. We're remote, employing 25+ around the world, 
          from California to Japan and everywhere in between.
        </p>
        
        <p style={{ marginBottom: '1rem', lineHeight: '1.5' }}>
          You can deploy anything on Railway, including this website.
        </p>
        
        <p style={{ 
          fontFamily: 'monospace',
          marginBottom: '1rem',
          lineHeight: '1.5'
        }}>
          It's served via IP address 66.33.22.11 (φ^-1), by ASN 400940, and runs 
          in {regions.length} different locations, across 3 different countries, 
          on servers we own.
        </p>
        
        <p style={{ 
          fontStyle: 'italic',
          marginBottom: '2rem',
          lineHeight: '1.5'
        }}>
          All requests to this website can be seen in real-time to your right.
        </p>

        <div>
          <div style={{ marginBottom: '0.5rem' }}>
            Your Region ({currentRegion}): {localRegions.find(r => r.region === currentRegion)?.count ?? 0}
          </div>
          <button
            onClick={incrementCounter}
            disabled={!ws || ws.readyState !== WebSocket.OPEN || !userLocation}
            style={{
              backgroundColor: '#5CC5B9',
              padding: '0.5rem 1rem',
              borderRadius: '0.25rem',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              opacity: (!ws || ws.readyState !== WebSocket.OPEN || !userLocation) ? 0.5 : 1,
              fontSize: '0.875rem'
            }}
          >
            Increment Counter
          </button>
          <div style={{ 
            fontSize: '0.875rem',
            opacity: 0.5,
            marginTop: '0.5rem'
          }}>
            {/* Only show status if we're connected or it's not the initial load */}
            {(!initialConnection.current || status === "connected") && (
              <>Status: {status}</>
            )}
          </div>
        </div>
      </div>

      {/* Right Column - Globe */}
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#13111C',
        overflow: 'hidden'
      }}>
        <GlobeViz 
          regions={localRegions} 
          currentRegion={currentRegion} 
          connections={connections} 
          userLocation={userLocation}
          width={1000}
          height={1000}
        />
      </div>
    </div>
  );
}