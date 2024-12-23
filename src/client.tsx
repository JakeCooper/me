import React from "react";
import { hydrateRoot } from "react-dom/client";
import { Counter } from "./components/Counter";

declare global {
  interface Window {
    __INITIAL_DATA__: {
      regions: Array<{
        region: string;
        count: number;
        lastUpdate: number;
      }>;
      currentRegion: string;
    };
  }
}

const root = document.getElementById("root");
if (root) {
  const { regions, currentRegion } = window.__INITIAL_DATA__;
  hydrateRoot(root, <Counter regions={regions} currentRegion={currentRegion} />);
}