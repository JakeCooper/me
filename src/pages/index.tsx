import React from "react";

export function App() {
  const [count, setCount] = React.useState(0);

  return (
    <div>
      <h1>Welcome to Bun SSR!</h1>
      <button onClick={() => setCount(count + 1)}>
        Count is: {count}
      </button>
    </div>
  );
}
