import React, { useEffect, useRef, useMemo } from "react";
import { Color } from "three";
import * as THREE from 'three';
import { countries } from "./countries";
import { applyDeviceOffset } from "./fingerprint";
import { getRailwayTeamCount } from "../utils/railway-team";

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface Connection {
  id: string;
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

interface GlobeVizProps {
  regions: RegionData[];
  currentRegion: string;
  connections: Connection[];
  shootingStars: ShootingStar[];
  animatingConnections: AnimatingConnection[];
  userLocation: { lat: number; lng: number } | null;
  connectedUsers: Array<{ lat: number; lng: number }>;
  width?: number;
  height?: number;
}

interface ShootingStar {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  animationDuration: number;
}

interface AnimatingConnection {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  animationDuration: number;
  progress: number; // 0 to 1
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
    opacity: 1,
    shininess: 0.3,
    pointColor: "#E835A0",
    emissive: new Color("#ffffff"),
    emissiveIntensity: 0.1,
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

// Consolidated region mapping
const REGION_CONSOLIDATION = {
  'us-west1': 'US West',
  'us-west2': 'US West', // Metal Oregon
  'us-east1': 'US East',
  'us-east4': 'US East',
  'us-east4-eqdc4a': 'US East', // Metal Virginia
  'europe': 'Europe',
  'europe-west4': 'Europe',
  'europe-west4-drams3a': 'Europe', // Metal Netherlands
  'asia': 'Asia',
  'asia-southeast1': 'Asia',
  'asia-southeast1-eqsg3a': 'Asia' // Metal Singapore
};

// Consolidated datacenter locations (using the primary location for each region)
const CONSOLIDATED_DATACENTER_LOCATIONS = {
  'US West': [45.5945, -122.1562],    // Oregon
  'US East': [38.7223, -77.0196],     // Virginia  
  'Europe': [53.4478, 6.8367],        // Netherlands
  'Asia': [1.3521, 103.8198]          // Singapore
};

if (typeof window !== 'undefined') {
  // Pre-import the module to reduce flash
  const globe = require('react-globe.gl').default;
  ReactGlobe = globe;
}

// Function to consolidate regions data
const consolidateRegions = (regions: RegionData[]): RegionData[] => {
  const consolidated = new Map<string, RegionData>();
  
  regions.forEach(region => {
    const consolidatedName = REGION_CONSOLIDATION[region.region] || region.region;
    
    if (consolidated.has(consolidatedName)) {
      const existing = consolidated.get(consolidatedName)!;
      consolidated.set(consolidatedName, {
        region: consolidatedName,
        count: existing.count + region.count,
        lastUpdate: region.lastUpdate > existing.lastUpdate ? region.lastUpdate : existing.lastUpdate
      });
    } else {
      consolidated.set(consolidatedName, {
        region: consolidatedName,
        count: region.count,
        lastUpdate: region.lastUpdate
      });
    }
  });
  
  return Array.from(consolidated.values());
};

const GlobeViz = ({ regions, currentRegion, connections = [], shootingStars = [], animatingConnections = [], userLocation, connectedUsers = [] }: GlobeVizProps) => {
  const globeEl = useRef<any>();
  const [isLoaded, setIsLoaded] = React.useState(false);

  useEffect(() => {
    if (globeEl.current) {
      setIsLoaded(true);
    }
  }, [globeEl.current]);

  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Consolidate regions and get current consolidated region
  const consolidatedRegions = useMemo(() => consolidateRegions(regions), [regions]);
  const currentConsolidatedRegion = REGION_CONSOLIDATION[currentRegion] || currentRegion;

  // Setup points data with labels using consolidated regions
  const datacenterPoints = useMemo(() =>
    Object.entries(CONSOLIDATED_DATACENTER_LOCATIONS).map(([region, [lat, lng]]) => {
      const regionData = consolidatedRegions.find(r => r.region === region);
      return {
        lat,
        lng,
        size: region === currentConsolidatedRegion ? 1.5 : 1,
        color: region === currentConsolidatedRegion ? '#E835A0' : "#7b0cd0",
        region,
        count: regionData?.count ?? 0,
        type: 'datacenter'
      };
    }),
    [consolidatedRegions, currentConsolidatedRegion]
  );

  const userPoints = useMemo(() => [
    ...(userLocation ? [{
      lat: userLocation.lat,
      lng: userLocation.lng,
      size: 1,
      color: '#22c55e', // green-500
      type: 'currentUser'
    }] : []),
    ...connectedUsers.map(user => ({
      lat: user.lat,
      lng: user.lng,
      size: 1,
      color: '#22c55e', // green-500
      type: 'connectedUser'
    }))
  ], [userLocation, connectedUsers]);

  const styles: GlobeStyles = useMemo(
    () => globeStyles["dark"],
    [],
  );

  // Get set of currently animating connection IDs
  const animatingIds = useMemo(() =>
    new Set(animatingConnections.map(c => c.id)),
    [animatingConnections]
  );

  // Persistent connection arcs (dotted, slowly animated)
  // Hide connections that are currently being drawn
  const persistentArcs = useMemo(() =>
    connections
      .filter(conn => !animatingIds.has(conn.id))
      .map(conn => {
        const connectionConsolidatedRegion = REGION_CONSOLIDATION[conn.to.region] || conn.to.region;

        return {
          id: conn.id,
          startLat: conn.from.lat,
          startLng: conn.from.lng,
          endLat: conn.to.lat,
          endLng: conn.to.lng,
          color: connectionConsolidatedRegion === currentConsolidatedRegion
            ? 'rgba(232, 53, 160, 0.6)'
            : 'rgba(123, 12, 208, 0.5)',
          altitude: 0.08,
          stroke: 0.8,
          // Dotted line with slow animation
          dashLength: 0.1,
          dashGap: 0.05,
          dashAnimateTime: 8000, // Slow moving dots
        };
      }),
    [connections, currentConsolidatedRegion, animatingIds]
  );

  // Animating connection arcs (line drawing itself in)
  // Uses dash pattern to reveal the arc progressively from start to end
  const animatingArcs = useMemo(() =>
    animatingConnections.map(conn => {
      // progress goes 0 to 1, dashLength reveals that portion
      const revealLength = Math.max(0.01, conn.progress);
      const hideLength = Math.max(0.01, 1 - conn.progress);

      return {
        id: `animating-${conn.id}`,
        // Swap start/end so dash pattern reveals from user towards datacenter
        startLat: conn.endLat,
        startLng: conn.endLng,
        endLat: conn.startLat,
        endLng: conn.startLng,
        color: conn.color,
        altitude: 0.08,
        stroke: 0.8,
        // Reveal from start: visible portion grows, hidden portion shrinks
        dashLength: revealLength,
        dashGap: hideLength,
        dashAnimateTime: 0,
      };
    }),
    [animatingConnections]
  );

  // Shooting star arcs (animated on increment)
  const shootingStarArcs = useMemo(() =>
    shootingStars.map(star => ({
      id: star.id,
      startLat: star.startLat,
      startLng: star.startLng,
      endLat: star.endLat,
      endLng: star.endLng,
      color: '#FFD700', // Golden yellow
      altitude: 0.25, // Higher arc
      stroke: 0.8, // Smaller/thinner
      dashLength: 0.08, // Small bright head
      dashGap: 0.92, // Long tail
      dashAnimateTime: star.animationDuration, // Based on arc distance
    })),
    [shootingStars]
  );

  // Combine all arcs
  const arcData = useMemo(() =>
    [...persistentArcs, ...animatingArcs, ...shootingStarArcs],
    [persistentArcs, animatingArcs, shootingStarArcs]
  );

  useEffect(() => {
    if (globeEl.current) {
      const globe = globeEl.current;
      
      // Set initial position
      globe.pointOfView(MAP_CENTER, 0);
      
      // Setup controls after ensuring position is set
      requestAnimationFrame(() => {
        globe.controls().autoRotate = true;
        globe.controls().enableZoom = false;
        globe.controls().autoRotateSpeed = -0.5;
        
        // Maybe add a small transition to opacity
        setIsLoaded(true);
      });
    }
  }, [globeEl.current]);

  const arcDashAnimateTime = d => d.dashAnimateTime || 0;

  return mounted ? (
    <div style={{
      background: '#13111C',
      transition: 'opacity 0.3s ease-in-out',
      opacity: isLoaded ? 1 : 0
    }}>
      <ReactGlobe
        ref={globeEl}
        width={800}
        height={800}
        
        customLayerData={[...datacenterPoints, ...userPoints]}
        customThreeObject={d => {
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
        arcStroke={'stroke'}
        arcDashLength={'dashLength'}
        arcDashGap={'dashGap'}
        arcDashAnimateTime={arcDashAnimateTime}
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
            transparent: false,
            opacity: 1,
            shininess: 0.2
          })
        }
      />
    </div>
  ): null;
}

interface CachedLocation {
  lat: number;
  lng: number;
  timestamp: number;
}

// Function to get cached location
const getCachedLocation = (): CachedLocation | null => {
  const cached = localStorage.getItem('userLocation');
  if (!cached) return null;
  
  const data = JSON.parse(cached) as CachedLocation;
  const TTL = 60 * 1000; // 1 minute in milliseconds
  
  if (Date.now() - data.timestamp > TTL) {
    localStorage.removeItem('userLocation');
    return null;
  }
  
  return data;
};

const IP_URL = process.env.NODE_ENV == "production" ? 'https://ipwho.is/' : 'http://ipwho.is/';

// Default location fallback
const DEFAULT_LOCATION = { lat: 37.7749, lng: -122.4194 }; // San Francisco

// Calculate great-circle distance in degrees (0-180)
const getArcDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return c * 180 / Math.PI; // Return degrees
};

// Interpolate between two points along a great circle path
const interpolateGreatCircle = (
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  t: number // 0 to 1
): { lat: number; lng: number } => {
  if (t <= 0) return { lat: lat1, lng: lng1 };
  if (t >= 1) return { lat: lat2, lng: lng2 };

  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;

  const φ1 = toRad(lat1), λ1 = toRad(lng1);
  const φ2 = toRad(lat2), λ2 = toRad(lng2);

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));

  if (d === 0) return { lat: lat1, lng: lng1 };

  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);

  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);

  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: toDeg(Math.atan2(y, x))
  };
};

// Calculate animation duration based on arc distance and altitude
const getAnimationDuration = (lat1: number, lng1: number, lat2: number, lng2: number, altitude: number = 0.1): number => {
  const distance = getArcDistance(lat1, lng1, lat2, lng2);
  // Higher arcs travel longer paths - approximate with altitude multiplier
  const arcLengthMultiplier = 1 + (altitude * 2);
  const effectiveDistance = distance * arcLengthMultiplier;
  const velocity = 10; // degrees per second
  const baseDuration = (effectiveDistance / velocity) * 1000;
  return baseDuration;
};

export function Counter({ regions, currentRegion }: CounterProps) {
  const [localRegions, setLocalRegions] = React.useState(regions);
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [shootingStars, setShootingStars] = React.useState<ShootingStar[]>([]);
  const [animatingConnections, setAnimatingConnections] = React.useState<AnimatingConnection[]>([]);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [status, setStatus] = React.useState("loading");
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);
  const [teamCount, setTeamCount] = React.useState(25);
  const [contentExpanded, setContentExpanded] = React.useState(false);
  const initialConnection = React.useRef(true);

  // Helper to animate a connection drawing in
  const animateConnection = React.useCallback((conn: Connection) => {
    const altitude = 0.1; // matches animatingArcs altitude
    const duration = getAnimationDuration(
      conn.from.lat,
      conn.from.lng,
      conn.to.lat,
      conn.to.lng,
      altitude
    );

    const animating: AnimatingConnection = {
      id: conn.id,
      startLat: conn.from.lat,
      startLng: conn.from.lng,
      endLat: conn.to.lat,
      endLng: conn.to.lng,
      color: '#E835A0',
      animationDuration: duration,
      progress: 0,
    };

    setAnimatingConnections(prev => [...prev, animating]);

    // Animate progress from 0 to 1
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      setAnimatingConnections(prev =>
        prev.map(c => c.id === conn.id ? { ...c, progress } : c)
      );

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Remove after a small delay to ensure smooth transition
        setTimeout(() => {
          setAnimatingConnections(prev => prev.filter(c => c.id !== conn.id));
        }, 50);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    // First try cache
    const cached = getCachedLocation();
    if (cached) {
      setUserLocation({
        lat: cached.lat,
        lng: cached.lng
      });
      return;
    }
  
    // If no cache, fetch from API
    fetch(IP_URL)
      .then(res => res.json())
      .then(data => {
        const baseLocation = {
          lat: data.latitude,
          lng: data.longitude
        };
        
        // Apply the device-specific offset
        const location = applyDeviceOffset(baseLocation);
        
        setUserLocation(location);
        
        // Cache the result with timestamp
        localStorage.setItem('userLocation', JSON.stringify({
          ...location,
          timestamp: Date.now()
        }));
      })
      .catch(error => {
        console.error("Error getting IP location:", error);
        // Fallback to default location with offset
        const baseLocation = {
          lat: DATACENTER_LOCATIONS[currentRegion]?.[0] ?? DEFAULT_LOCATION.lat,
          lng: DATACENTER_LOCATIONS[currentRegion]?.[1] ?? DEFAULT_LOCATION.lng
        };
        setUserLocation(applyDeviceOffset(baseLocation));
      });
  }, [currentRegion]);

  const [connectedUsers, setConnectedUsers] = React.useState<Array<{ lat: number; lng: number }>>([]);

  // Fetch team count on mount
  useEffect(() => {
    getRailwayTeamCount().then(setTeamCount);
  }, []);

  useEffect(() => {
    let reconnectTimer: number;
    let isConnecting = false;
    let mounted = true;
  
    // Add a small delay to ensure client hydration is complete
    const connectTimeout = setTimeout(() => {
      function connect() {
        if (!mounted || isConnecting) return;
        isConnecting = true;
  
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const websocket = new WebSocket(`${protocol}//${window.location.host}`);
        
        websocket.onopen = () => {
          if (!mounted) {
            websocket.close();
            return;
          }
          console.log('WebSocket connected');
          setStatus("connected");
          setWs(websocket);
          isConnecting = false;
          initialConnection.current = false;
  
          if (userLocation) {
            websocket.send(JSON.stringify({
              type: "connected",
              location: userLocation,
            }));
          }
        };
  
        websocket.onmessage = (event) => {
          if (!mounted) return;
          const data = JSON.parse(event.data);
          
          if (data.type === "state") {
            setLocalRegions(data.regions);
            if (data.connectedUsers) {
              setConnectedUsers(data.connectedUsers);
            }
            if (data.connections && Array.isArray(data.connections)) {
              // Instead of replacing, merge with existing while preserving animation state
              setConnections(prev => {
                const existingIds = new Set(prev.map(c => c.id));
                const newConnections = data.connections.filter(c => !existingIds.has(c.id));
                // Animate each new connection
                newConnections.forEach(conn => animateConnection(conn));
                return [...prev, ...newConnections];
              });
            }
          }

          if (data.type === "userUpdate") {
            if (data.connectedUsers) {
              setConnectedUsers(data.connectedUsers);
            }
            if (data.disconnectedUser?.connection) {
              // Keep the animation state for all other connections
              setConnections(prev =>
                prev.filter(conn => conn.id !== data.disconnectedUser.connection.id)
              );
            }
          }

          if (data.type === "update" && data.connection) {
            // Only add if not already present
            setConnections(prev => {
              if (prev.some(conn => conn.id === data.connection.id)) {
                return prev;
              }
              // Animate the new connection
              animateConnection(data.connection);
              return [...prev, data.connection];
            });
          }
        };
  
        websocket.onclose = () => {
          if (!mounted) return;
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
          if (!initialConnection.current && mounted) {
            websocket.close();
          }
        };
  
        return websocket;
      }
  
      const ws = connect();
  
      return () => {
        if (ws) {
          ws.close();
        }
      };
    }, 100);
  
    // Cleanup function
    return () => {
      mounted = false;
      clearTimeout(connectTimeout);
      clearTimeout(reconnectTimer);
    };
  }, [userLocation]); // Only reconnect if userLocation changes

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

      // Find the user's connection to create a shooting star
      const userConnection = connections.find(conn =>
        conn.from.lat === userLocation.lat && conn.from.lng === userLocation.lng
      );

      if (userConnection) {
        // Calculate animation duration based on arc distance and altitude
        const altitude = 0.25; // matches shootingStarArcs altitude
        const duration = getAnimationDuration(
          userConnection.from.lat,
          userConnection.from.lng,
          userConnection.to.lat,
          userConnection.to.lng,
          altitude
        );

        // Send a shooting star along the connection line
        const starId = `star-${Date.now()}`;
        const newStar: ShootingStar = {
          id: starId,
          startLat: userConnection.from.lat,
          startLng: userConnection.from.lng,
          endLat: userConnection.to.lat,
          endLng: userConnection.to.lng,
          color: '#FFD700',
          animationDuration: duration
        };

        setShootingStars(prev => [...prev, newStar]);

        // Remove after animation + time for star to fully land
        const landingBuffer = duration * 0.04;
        setTimeout(() => {
          setShootingStars(prev => prev.filter(s => s.id !== starId));
        }, duration + landingBuffer);
      }
    }
  };

  return (
    <div className="main-layout">
      {/* Left Column - Content */}
      <div className={`content-column ${contentExpanded ? 'expanded' : ''}`}>
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 600,
          marginBottom: '1.5rem',
          marginTop: 0,
          color: '#ffffff'
        }}>
          Hello
        </h1>
        
        <p style={{
          marginBottom: '1rem',
          fontSize: '1rem',
          lineHeight: '1.6',
          color: 'rgba(255, 255, 255, 0.8)'
        }}>
          My name is Jake Cooper.
          <br />
          I'm a technologist originally from Canada.
        </p>

        <p style={{ marginBottom: '1rem', lineHeight: '1.6', color: 'rgba(255, 255, 255, 0.8)' }}>
          I currently live in San Francisco, where I run{" "}
          <a
            href="https://railway.com"
            style={{
              color: '#E835A0',
              textDecoration: 'none'
            }}
          >
            Railway.com
          </a>
          , an infrastructure startup. We're remote, employing {teamCount} people around the world,
          from California to Japan and everywhere in between.
        </p>

        <p style={{ marginBottom: '1rem', lineHeight: '1.6', color: 'rgba(255, 255, 255, 0.8)' }}>
          You can deploy anything on Railway.
          <br />
          This website included.
        </p>

        <p style={{
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          marginBottom: '1rem',
          lineHeight: '1.6',
          color: 'rgba(255, 255, 255, 0.6)',
          padding: '1rem',
          background: 'rgba(123, 12, 208, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(123, 12, 208, 0.2)',
          fontSize: '0.875rem'
        }}>
          It's served via IP address 66.33.22.11, by <a href="https://bgp.tools/as/400940" style={{ color: '#E835A0', textDecoration: 'none' }}>ASN 400940</a>, and runs
          in {consolidateRegions(regions).length} different regions, across 3 different countries,
          on servers we own.
        </p>

        <p style={{
          fontStyle: 'italic',
          marginBottom: '2rem',
          lineHeight: '1.6',
          color: 'rgba(255, 255, 255, 0.5)'
        }}>
          All current website visitors are visible in real-time on the globe.
        </p>

        <div
          className="increment-section"
          style={{
            padding: '1.5rem',
            background: 'rgba(123, 12, 208, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(123, 12, 208, 0.2)'
          }}>
          <div style={{
            marginBottom: '1rem',
            fontSize: '0.875rem',
            color: 'rgba(255, 255, 255, 0.7)'
          }}>
            Your Region ({REGION_CONSOLIDATION[currentRegion] || currentRegion}): <span style={{ color: '#E835A0', fontWeight: 600 }}>{consolidateRegions(localRegions).find(r => r.region === (REGION_CONSOLIDATION[currentRegion] || currentRegion))?.count ?? 0}</span>
          </div>
          <button
            onClick={incrementCounter}
            disabled={!ws || ws.readyState !== WebSocket.OPEN || !userLocation}
            style={{
              background: '#7b0cd0',
              padding: '0.75rem 1.5rem',
              borderRadius: '6px',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              opacity: (!ws || ws.readyState !== WebSocket.OPEN || !userLocation) ? 0.5 : 1,
              fontSize: '0.875rem',
              fontWeight: 500,
              transition: 'all 0.2s ease'
            }}
          >
            Increment Counter
          </button>
          <div style={{
            fontSize: '0.75rem',
            color: 'rgba(255, 255, 255, 0.4)',
            marginTop: '1rem'
          }}>
            {/* Only show status if we're connected or it's not the initial load */}
            {(!initialConnection.current || status === "connected") && (
              <>Status: {status}</>
            )}
          </div>
        </div>

      </div>

      {/* Pull tab - mobile only */}
      <button
        className="pull-tab"
        onClick={() => setContentExpanded(!contentExpanded)}
        aria-label={contentExpanded ? "Collapse content" : "Expand content"}
      />

      {/* Right Column - Globe (Bottom on mobile) */}
      <div className="globe-column">
        <GlobeViz
          regions={localRegions}
          currentRegion={currentRegion}
          connections={connections}
          shootingStars={shootingStars}
          animatingConnections={animatingConnections}
          userLocation={userLocation}
          connectedUsers={connectedUsers}
          width={1000}
          height={1000}
        />
      </div>

      {/* Floating bar - right side on desktop, bottom on mobile */}
      <div className="floating-bar">
        <div style={{
          fontSize: '0.875rem',
          color: 'rgba(255, 255, 255, 0.7)'
        }}>
          {REGION_CONSOLIDATION[currentRegion] || currentRegion}: <span style={{ color: '#E835A0', fontWeight: 600 }}>{consolidateRegions(localRegions).find(r => r.region === (REGION_CONSOLIDATION[currentRegion] || currentRegion))?.count ?? 0}</span>
        </div>
        <button
          onClick={incrementCounter}
          disabled={!ws || ws.readyState !== WebSocket.OPEN || !userLocation}
          style={{
            background: '#7b0cd0',
            padding: '0.6rem 1.25rem',
            borderRadius: '6px',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            opacity: (!ws || ws.readyState !== WebSocket.OPEN || !userLocation) ? 0.5 : 1,
            fontSize: '0.875rem',
            fontWeight: 500,
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap'
          }}
        >
          Increment
        </button>
      </div>
    </div>
  );
}