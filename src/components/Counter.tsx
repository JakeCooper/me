// src/Counter.tsx
import React, { useEffect, useRef, useMemo } from "react";
import { Color, MeshPhongMaterial } from "three";
import * as topojson from 'topojson-client';
import world from '../world.json'; // We'll create this

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
  const size = Math.min(window.innerWidth - 40, 800);

  // Convert TopoJSON to GeoJSON
  const worldData = useMemo(() => {
    const world = fetch('/world.json').then(r => r.json());
    const countries = topojson.feature(world, world.objects.countries);
    return countries.features;
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

  return (
    <Globe
      ref={globeEl}
      width={size}
      height={size}
      globeMaterial={globeMaterial}
      animateIn={false}
      
      // Country borders
      hexPolygonsData={worldData}
      hexPolygonResolution={3}
      hexPolygonMargin={0.7}
      hexPolygonColor={() => "rgba(146,65,211, 0.1)"}
      
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