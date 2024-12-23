import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface RegionData {
  region: string;
  count: number;
  lastUpdate: string;
}

interface CounterProps {
  regions: RegionData[];
  currentRegion: string;
}

// Convert lat/long to 3D coordinates on a sphere
function latLongToVector3(lat: number, long: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (long + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = (radius * Math.sin(phi) * Math.sin(theta));
  const y = (radius * Math.cos(phi));

  return new THREE.Vector3(x, y, z);
}

// Datacenter coordinates [latitude, longitude]
const DATACENTER_LOCATIONS = {
  'us-west1': [45.5155, -122.6789],     // Oregon
  'us-east4': [37.7749, -77.4194],      // Virginia
  'europe-west4': [52.3676, 4.9041],    // Netherlands
  'asia-southeast1': [1.3521, 103.8198], // Singapore
};

function Globe({ regions, currentRegion }: CounterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isMouseDown = useRef(false);
  const mousePosition = useRef({ x: 0, y: 0 });
  const globe = useRef<THREE.Mesh>();
  const renderer = useRef<THREE.WebGLRenderer>();
  const scene = useRef<THREE.Scene>();
  const camera = useRef<THREE.PerspectiveCamera>();

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    scene.current = new THREE.Scene();
    scene.current.background = new THREE.Color('#0a0a24');

    // Camera setup
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    camera.current = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.current.position.z = 500;

    // Renderer setup
    renderer.current = new THREE.WebGLRenderer({ antialias: true });
    renderer.current.setSize(width, height);
    containerRef.current.appendChild(renderer.current.domElement);

    // Globe
    const radius = 200;
    const segments = 50;
    const geometry = new THREE.SphereGeometry(radius, segments, segments);
    
    // Create dot texture for globe
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw dots
    ctx.fillStyle = '#1a237e';
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
    });

    globe.current = new THREE.Mesh(geometry, material);
    scene.current.add(globe.current);

    // Add datacenters
    Object.entries(DATACENTER_LOCATIONS).forEach(([region, [lat, long]]) => {
      const position = latLongToVector3(lat, long, radius + 2);
      const regionData = regions.find(r => r.region === region);
      
      // Marker geometry
      const markerGeometry = new THREE.SphereGeometry(3, 16, 16);
      const markerMaterial = new THREE.MeshBasicMaterial({ 
        color: region === currentRegion ? '#ff69b4' : '#4a148c',
        transparent: true,
        opacity: 0.8
      });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.copy(position);
      scene.current!.add(marker);

      // Count label
      if (regionData) {
        const count = regionData.count.toString();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = 128;
        canvas.height = 64;
        ctx.fillStyle = 'white';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(count, canvas.width / 2, canvas.height / 2);
        
        const labelTexture = new THREE.CanvasTexture(canvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
        const label = new THREE.Sprite(labelMaterial);
        label.position.copy(position.multiplyScalar(1.1));
        label.scale.set(30, 15, 1);
        scene.current!.add(label);
      }
    });

    // Animation
    let animationFrame: number;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      if (globe.current && !isMouseDown.current) {
        globe.current.rotation.y += 0.001;
      }
      renderer.current!.render(scene.current!, camera.current!);
    };
    animate();

    // Event handlers
    const handleMouseDown = (e: MouseEvent) => {
      isMouseDown.current = true;
      mousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isMouseDown.current = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDown.current || !globe.current) return;

      const deltaX = e.clientX - mousePosition.current.x;
      const deltaY = e.clientY - mousePosition.current.y;

      globe.current.rotation.y += deltaX * 0.005;
      globe.current.rotation.x += deltaY * 0.005;

      mousePosition.current = { x: e.clientX, y: e.clientY };
    };

    containerRef.current.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);

    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousedown', handleMouseDown);
      }
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrame);
      renderer.current?.dispose();
    };
  }, [regions, currentRegion]);

  return <div ref={containerRef} style={{ width: '800px', height: '600px' }} />;
}

export function Counter({ regions, currentRegion }: CounterProps) {
  const [localRegions, setLocalRegions] = React.useState(regions);
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [status, setStatus] = React.useState("loading");

  // WebSocket setup...
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
        backgroundColor: '#0a0a24',
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
            backgroundColor: '#ff69b4',
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

      <Globe regions={localRegions} currentRegion={currentRegion} />
    </div>
  );
}