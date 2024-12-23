import { createClient } from 'redis';

// Helper function to get Redis URL based on region
function getRedisUrl(region: string): string {
  const urlMap: Record<string, string> = {
    'us-west2': process.env.REDIS_WEST_URL!,
    'us-east1': process.env.REDIS_EAST_URL!,
    'europe': process.env.REDIS_EUROPE_URL!,
    'asia': process.env.REDIS_ASIA_URL!
  };
  return urlMap[region] || process.env.REDIS_WEST_URL!; // Default to West if unknown region
}

export async function getOrCreateCounter(region: string): Promise<number> {
  const client = createClient({
    url: getRedisUrl(region)
  });

  try {
    await client.connect();
    
    // Key format: counter:{region}
    const key = `counter:${region}`;
    
    // Get current value or set to 0 if doesn't exist
    const value = await client.get(key);
    if (value === null) {
      await client.set(key, '0');
      return 0;
    }
    
    return parseInt(value, 10);
  } catch (error) {
    console.error(`Redis error for ${region}:`, error);
    return 0;
  } finally {
    await client.disconnect();
  }
}

// Also add function to increment counter
export async function incrementCounter(region: string): Promise<number> {
  const client = createClient({
    url: getRedisUrl(region)
  });

  try {
    await client.connect();
    const key = `counter:${region}`;
    const newValue = await client.incr(key);
    return newValue;
  } catch (error) {
    console.error(`Redis increment error for ${region}:`, error);
    throw error;
  } finally {
    await client.disconnect();
  }
}