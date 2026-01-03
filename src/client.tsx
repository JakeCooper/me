import React from "react";
import { hydrateRoot } from "react-dom/client";
import { Counter } from "./components/Counter";
import type { RegionData } from "./types";

declare global {
  interface Window {
    __INITIAL_DATA__: {
      regions: Array<RegionData>;
      currentRegion: string;
    };
  }
}

const root = document.getElementById("root");
if (root) {
  const { regions, currentRegion } = window.__INITIAL_DATA__;
  hydrateRoot(root, <Counter regions={regions} currentRegion={currentRegion} />);
}

// Dev hot reload - reload when server restarts
if (process.env.NODE_ENV !== 'production') {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  const devWs = new WebSocket(`${protocol}//${window.location.host}`);
  devWs.onclose = () => {
    // Server restarted, poll until it's back then reload
    const poll = setInterval(() => {
      fetch('/').then(() => {
        clearInterval(poll);
        window.location.reload();
      }).catch(() => {});
    }, 200);
  };
}