export async function getRailwayTeamCount(): Promise<number> {
  try {
    const response = await fetch('/api/railway-team-count');
    const data = await response.json();
    return data.count || 25; // fallback to 25 if API fails
  } catch (error) {
    console.error('Error fetching Railway team count:', error);
    return 25; // fallback
  }
}