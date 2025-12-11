const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://tnidhgcajvffrdtrspum.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuaWRoZ2NhanZmZnJkdHJzcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE3MTI4MjgsImV4cCI6MjA2NzI4ODgyOH0.GShB2A2mgo6YP6_DicVQ3Scr4Y7C4NuRUhE6iXFVEpk'
);

const DEFAULT_IMAGE = 'https://99expert.com/99expert-logo.png';
const BASE_URL = 'https://99expert.com';

// Crawler detection
const CRAWLERS = [
  'facebookexternalhit', 'Facebot', 'Twitterbot', 'LinkedInBot',
  'Pinterest', 'Slackbot', 'TelegramBot', 'WhatsApp', 'Discordbot',
  'Googlebot', 'bingbot', 'bot', 'crawler', 'spider', 'preview'
];

function isCrawler(userAgent) {
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  return CRAWLERS.some(c => ua.includes(c.toLowerCase()));
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getImageType(url) {
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  if (url.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function generateHtml({ title, description, image, pageUrl, type }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const imageType = getImageType(image);

  return `<!DOCTYPE html>
<html lang="da" prefix="og: http://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  
  <meta property="og:type" content="${type === 'talk' ? 'article' : 'profile'}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:secure_url" content="${image}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta property="og:site_name" content="99expert" />
  <meta property="og:locale" content="da_DK" />
  
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${image}" />
  
  <meta name="description" content="${safeDescription}" />
  <link rel="canonical" href="${pageUrl}" />
</head>
<body>
  <p>Redirecting to ${safeTitle}...</p>
  <script>window.location.href = "${pageUrl}";</script>
  <noscript><a href="${pageUrl}">Click here to continue</a></noscript>
</body>
</html>`;
}

// Expert route
app.get('/expert/:id', async (req, res) => {
  const { id } = req.params;
  const userAgent = req.headers['user-agent'];
  const targetUrl = `${BASE_URL}/shared/expert/${id}`;

  // Redirect non-crawlers immediately
  if (!isCrawler(userAgent)) {
    return res.redirect(302, targetUrl);
  }

  try {
    const { data: expert } = await supabase
      .from('experts')
      .select('name, roles, intro, profile_image_url')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (!expert) {
      return res.redirect(302, targetUrl);
    }

    const roleDisplay = expert.roles?.[0] || 'Ekspert';
    const html = generateHtml({
      title: `${expert.name} - ${roleDisplay} | 99expert`,
      description: expert.intro?.slice(0, 160) || `${expert.name} på 99expert`,
      image: expert.profile_image_url || DEFAULT_IMAGE,
      pageUrl: targetUrl,
      type: 'expert'
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error fetching expert:', error);
    res.redirect(302, targetUrl);
  }
});

// Talk/Arrangement route
app.get('/talk/:id', async (req, res) => {
  const { id } = req.params;
  const userAgent = req.headers['user-agent'];
  const targetUrl = `${BASE_URL}/shared/talk/${id}`;

  if (!isCrawler(userAgent)) {
    return res.redirect(302, targetUrl);
  }

  try {
    const { data: talk } = await supabase
      .from('talks')
      .select('title, description, image_url, experts(name, profile_image_url)')
      .eq('id', id)
      .single();

    if (!talk) {
      return res.redirect(302, targetUrl);
    }

    const cleanDesc = talk.description?.replace(/<[^>]*>/g, '') || '';
    const html = generateHtml({
      title: `${talk.title} - ${talk.experts?.name || 'Ekspert'} | 99expert`,
      description: cleanDesc.slice(0, 160),
      image: talk.image_url || talk.experts?.profile_image_url || DEFAULT_IMAGE,
      pageUrl: targetUrl,
      type: 'talk'
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error fetching talk:', error);
    res.redirect(302, targetUrl);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback - redirect to main site
app.get('*', (req, res) => {
  res.redirect(302, BASE_URL);
});

app.listen(PORT, () => {
  console.log(`Prerender server running on port ${PORT}`);
});
