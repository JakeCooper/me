import React from "react";
import { Counter } from "./components/Counter";

export function App({ count }: { count: number }) {
  return <Counter initialCount={count} />;
}