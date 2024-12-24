import React from "react";
import { hydrateRoot } from "react-dom/client";
import { Counter } from "./components/Counter";
import type { RegionData } from "./types";
import './styles.css';

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