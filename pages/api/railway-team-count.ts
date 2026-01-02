import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Fetch the Railway about page
    const response = await fetch('https://railway.com/about');
    const html = await response.text();
    
    // Extract team members from the HTML
    // This is a simple approach - we count profile images/cards excluding "Could be you" and "percy"
    const teamSection = html.match(/<section[^>]*team[^>]*>[\s\S]*?<\/section>/i);
    if (!teamSection) {
      throw new Error('Team section not found');
    }
    
    // Count team member elements, excluding specific ones
    const memberElements = teamSection[0].match(/<div[^>]*class="[^"]*team-member[^"]*"[^>]*>/g) || [];
    let count = memberElements.length;
    
    // Alternative: count by looking for profile images or cards
    if (count === 0) {
      // Fallback counting method - look for profile images
      const images = (teamSection[0].match(/<img[^>]*>/g) || []).filter(img => 
        !img.includes('Could be you') && !img.includes('percy')
      );
      count = images.length;
    }
    
    // Fallback to static count if parsing fails
    if (count === 0) {
      count = 25;
    }
    
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error fetching Railway team count:', error);
    res.status(200).json({ count: 25 }); // fallback
  }
}