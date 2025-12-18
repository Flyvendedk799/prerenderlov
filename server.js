const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const probe = require('probe-image-size');
const sharp = require('sharp');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Logging utility
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    level,
    message,
    ...data
  };
  console.log(JSON.stringify(logData));
}

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestInfo = {
    method: req.method,
    path: req.path,
    url: req.url,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || 'unknown',
    headers: {
      host: req.headers.host,
      'user-agent': req.headers['user-agent']
    }
  };
  
  log('info', 'Incoming request', { type: 'request', ...requestInfo });

  // Log response when it finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    log('info', 'Request completed', {
      type: 'response',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://tnidhgcajvffrdtrspum.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuaWRoZ2NhanZmZnJkdHJzcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE3MTI4MjgsImV4cCI6MjA2NzI4ODgyOH0.GShB2A2mgo6YP6_DicVQ3Scr4Y7C4NuRUhE6iXFVEpk'
);

const BASE_URL = 'https://99expert.com';

// Fallback image - a reliable, properly-sized placeholder that always works
// This is guaranteed to be 1200x630 (optimal for OG) and always accessible
const FALLBACK_IMAGE = 'https://placehold.co/1200x630/1a1a2e/ffffff?text=99expert';

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

// OG image dimensions for social media (optimal for Facebook/LinkedIn)
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

/**
 * Optimize image URL for social media sharing
 * - Converts HTTP to HTTPS (required for LinkedIn)
 * - Ensures absolute URLs
 * - Returns transformation URL if image needs resizing
 */
function optimizeImageUrl(url, prerenderBaseUrl) {
  if (!url) return null;
  
  let optimizedUrl = url;
  
  // Ensure HTTPS (required for LinkedIn and best practices)
  if (optimizedUrl.startsWith('http://')) {
    optimizedUrl = optimizedUrl.replace('http://', 'https://');
  }
  
  // If we have a prerender base URL and it's not the fallback, use our transformation endpoint
  // This will resize images to 1200x630 on-the-fly
  if (prerenderBaseUrl && optimizedUrl !== FALLBACK_IMAGE && !optimizedUrl.includes('placehold.co')) {
    const encodedUrl = encodeURIComponent(optimizedUrl);
    return `${prerenderBaseUrl}/transform?url=${encodedUrl}`;
  }
  
  return optimizedUrl;
}

/**
 * URL-encode an image URL to handle spaces and special characters
 * Preserves the URL structure while encoding special characters
 * Handles already-encoded URLs to avoid double-encoding
 */
function encodeImageUrl(url) {
  if (!url) return url;
  
  // Check if URL is already encoded (contains % followed by hex digits)
  // If it's already encoded, decode it first to avoid double-encoding
  const isEncoded = /%[0-9A-Fa-f]{2}/.test(url);
  let urlToEncode = url;
  
  if (isEncoded) {
    try {
      // Decode first to avoid double-encoding
      urlToEncode = decodeURIComponent(url);
    } catch (error) {
      // If decoding fails, it might be partially encoded - use as is
      log('warn', 'Failed to decode URL, may be partially encoded', { url, error: error.message });
      urlToEncode = url;
    }
  }
  
  try {
    // Parse the URL to separate base URL from path
    const urlObj = new URL(urlToEncode);
    // Encode the pathname (handles spaces and special characters)
    // Only encode segments that aren't already encoded
    urlObj.pathname = urlObj.pathname.split('/').map(segment => {
      // Check if segment is already encoded
      if (/%[0-9A-Fa-f]{2}/.test(segment)) {
        return segment; // Already encoded, keep as is
      }
      return encodeURIComponent(segment);
    }).join('/');
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, try simple encoding
    // Split URL into base and path, encode the path part
    const parts = urlToEncode.split('/');
    if (parts.length > 3) {
      const base = parts.slice(0, 3).join('/');
      const path = parts.slice(3).map(segment => {
        // Check if segment is already encoded
        if (/%[0-9A-Fa-f]{2}/.test(segment)) {
          return segment; // Already encoded, keep as is
        }
        return encodeURIComponent(segment);
      }).join('/');
      return `${base}/${path}`;
    }
    // Fallback: encode the whole URL only if not already encoded
    if (isEncoded) {
      return url; // Return original if already encoded
    }
    return encodeURI(urlToEncode);
  }
}

// Minimum image dimensions for social media (Facebook requires 200x200)
const MIN_IMAGE_WIDTH = 200;
const MIN_IMAGE_HEIGHT = 200;

/**
 * Fetch actual image dimensions from URL
 * Returns { width, height, isTooSmall } or null if unable to fetch
 */
async function getImageDimensions(imageUrl) {
  if (!imageUrl) return null;
  
  // URL-encode the image URL to handle spaces and special characters
  const encodedUrl = encodeImageUrl(imageUrl);
  
  try {
    const result = await probe(encodedUrl, {
      timeout: 5000, // 5 second timeout
      retries: 1
    });
    
    if (result && result.width && result.height) {
      const isTooSmall = result.width < MIN_IMAGE_WIDTH || result.height < MIN_IMAGE_HEIGHT;
      
      log('info', 'Image dimensions fetched', { 
        url: encodedUrl, 
        width: result.width, 
        height: result.height,
        isTooSmall
      });
      
      return {
        width: result.width.toString(),
        height: result.height.toString(),
        isTooSmall
      };
    }
  } catch (error) {
    log('warn', 'Failed to fetch image dimensions', { 
      originalUrl: imageUrl,
      encodedUrl: encodedUrl,
      error: error.message,
      errorCode: error.code
    });
  }
  
  // Return null if unable to fetch - will use defaults
  return null;
}

function generateHtml({ title, description, image, pageUrl, prerenderUrl, type, imageWidth, imageHeight }) {
  const safeTitle = escapeHtml(title || '99expert');
  const safeDescription = escapeHtml(description || '99expert - Din ekspertplatform');
  // Ensure image is absolute URL and use HTTPS for LinkedIn compatibility
  let absoluteImage = image || FALLBACK_IMAGE;
  if (!absoluteImage.startsWith('http')) {
    // If relative URL, make it absolute
    absoluteImage = absoluteImage.startsWith('/') 
      ? `${BASE_URL}${absoluteImage}` 
      : `${BASE_URL}/${absoluteImage}`;
  }
  // Ensure HTTPS for LinkedIn (they prefer secure URLs)
  if (absoluteImage.startsWith('http://')) {
    absoluteImage = absoluteImage.replace('http://', 'https://');
  }
  // URL-encode the image URL to handle spaces and special characters (required for Facebook)
  absoluteImage = encodeImageUrl(absoluteImage);
  const imageType = getImageType(absoluteImage);
  const ogType = type === 'talk' ? 'article' : 'profile';

  // Use prerender URL for OG URL and canonical - this prevents LinkedIn from following redirects
  const ogUrl = prerenderUrl || pageUrl;
  const canonicalUrl = prerenderUrl || pageUrl;

  // Facebook requires accurate image dimensions - use provided or default to recommended OG image size
  // If dimensions aren't provided, use recommended 1200x630 but Facebook will validate
  const width = imageWidth || '1200';
  const height = imageHeight || '630';

  // LinkedIn-specific: For articles, add article meta tags
  const articleMeta = type === 'talk' ? `
  <meta property="article:author" content="99expert" />
  <meta property="article:published_time" content="${new Date().toISOString()}" />
  <meta property="article:section" content="Ekspertarrangement" />` : '';

  return `<!DOCTYPE html>
<html lang="da" prefix="og: http://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  
  <!-- Primary Meta Tags -->
  <meta name="title" content="${safeTitle}" />
  <meta name="description" content="${safeDescription}" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${ogUrl}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${absoluteImage}" />
  <meta property="og:image:secure_url" content="${absoluteImage}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="${width}" />
  <meta property="og:image:height" content="${height}" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta property="og:site_name" content="99expert" />
  <meta property="og:locale" content="da_DK" />${articleMeta}
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${absoluteImage}" />
  
  <!-- Canonical URL - use prerender URL to prevent LinkedIn from following redirects -->
  <link rel="canonical" href="${canonicalUrl}" />
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

  log('info', 'Expert route requested', { id, userAgent, isCrawler: isCrawler(userAgent) });

  // Redirect non-crawlers immediately
  if (!isCrawler(userAgent)) {
    log('info', 'Redirecting non-crawler', { id, userAgent, targetUrl });
    return res.redirect(302, targetUrl);
  }

  try {
    const { data: expert, error: expertError } = await supabase
      .from('experts')
      .select('name, roles, intro, profile_image_url')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (expertError) {
      log('error', 'Supabase error fetching expert', { id, error: expertError.message });
      return res.redirect(302, targetUrl);
    }

    if (!expert) {
      log('warn', 'Expert not found', { id });
      return res.redirect(302, targetUrl);
    }

    const roleDisplay = expert.roles?.[0] || 'Ekspert';
    const description = expert.intro?.trim() || `${expert.name} er ekspert på 99expert`;
    
    // Get the prerender base URL for transformation endpoint
    const prerenderBaseUrl = `${req.protocol}://${req.get('host')}`;
    const prerenderUrl = `${prerenderBaseUrl}${req.originalUrl}`;

    let imageUrl = expert.profile_image_url;
    let absoluteImageUrl;
    let imageWidth = OG_IMAGE_WIDTH.toString();
    let imageHeight = OG_IMAGE_HEIGHT.toString();
    
    if (imageUrl) {
      // Ensure image URL is absolute
      const originalImageUrl = imageUrl.startsWith('http') 
        ? imageUrl 
        : `${BASE_URL}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      
      // Ensure HTTPS
      const httpsImageUrl = originalImageUrl.startsWith('http://')
        ? originalImageUrl.replace('http://', 'https://')
        : originalImageUrl;
      
      // Use transformation endpoint to resize to 1200x630
      absoluteImageUrl = optimizeImageUrl(httpsImageUrl, prerenderBaseUrl);
      
      log('info', 'Using transformed image URL', { 
        original: httpsImageUrl,
        transformed: absoluteImageUrl
      });
    } else {
      // No image, use fallback
      absoluteImageUrl = FALLBACK_IMAGE;
    }

    log('info', 'Expert data fetched', { 
      id, 
      name: expert.name, 
      hasImage: !!expert.profile_image_url,
      imageUrl: absoluteImageUrl,
      imageWidth,
      imageHeight,
      descriptionLength: description.length,
      prerenderUrl
    });

    const html = generateHtml({
      title: `${expert.name} - ${roleDisplay} | 99expert`,
      description: description.slice(0, 160),
      image: absoluteImageUrl,
      pageUrl: targetUrl,
      prerenderUrl: prerenderUrl,
      type: 'expert',
      imageWidth,
      imageHeight
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    log('error', 'Error fetching expert', { id, error: error.message, stack: error.stack });
    res.redirect(302, targetUrl);
  }
});

// Talk/Arrangement route
app.get('/talk/:id', async (req, res) => {
  const { id } = req.params;
  const userAgent = req.headers['user-agent'];
  const targetUrl = `${BASE_URL}/shared/talk/${id}`;

  log('info', 'Talk route requested', { id, userAgent, isCrawler: isCrawler(userAgent) });

  if (!isCrawler(userAgent)) {
    log('info', 'Redirecting non-crawler', { id, userAgent, targetUrl });
    return res.redirect(302, targetUrl);
  }

  try {
    const { data: talk, error: talkError } = await supabase
      .from('talks')
      .select('title, description, image_url, experts(name, profile_image_url)')
      .eq('id', id)
      .single();

    if (talkError) {
      log('error', 'Supabase error fetching talk', { id, error: talkError.message });
      return res.redirect(302, targetUrl);
    }

    if (!talk) {
      log('warn', 'Talk not found', { id });
      return res.redirect(302, targetUrl);
    }

    // Handle experts array - get first expert if available
    const firstExpert = Array.isArray(talk.experts) && talk.experts.length > 0 
      ? talk.experts[0] 
      : null;
    
    // Clean description - remove HTML tags and trim
    const cleanDesc = talk.description
      ?.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() || `${talk.title} på 99expert`;
    
    const expertName = firstExpert?.name || 'Ekspert';

    // Get the prerender base URL for transformation endpoint
    const prerenderBaseUrl = `${req.protocol}://${req.get('host')}`;
    const prerenderUrl = `${prerenderBaseUrl}${req.originalUrl}`;

    // Determine image - prefer talk image, then expert image, then fallback
    let imageUrl = talk.image_url || firstExpert?.profile_image_url;
    let absoluteImageUrl;
    let imageWidth = OG_IMAGE_WIDTH.toString();
    let imageHeight = OG_IMAGE_HEIGHT.toString();
    
    if (imageUrl) {
      // Ensure image URL is absolute
      const originalImageUrl = imageUrl.startsWith('http') 
        ? imageUrl 
        : `${BASE_URL}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      
      // Ensure HTTPS
      const httpsImageUrl = originalImageUrl.startsWith('http://')
        ? originalImageUrl.replace('http://', 'https://')
        : originalImageUrl;
      
      // Use transformation endpoint to resize to 1200x630
      absoluteImageUrl = optimizeImageUrl(httpsImageUrl, prerenderBaseUrl);
      
      log('info', 'Using transformed image URL', { 
        original: httpsImageUrl,
        transformed: absoluteImageUrl
      });
    } else {
      // No image, use fallback
      absoluteImageUrl = FALLBACK_IMAGE;
    }

    log('info', 'Talk data fetched', { 
      id, 
      title: talk.title,
      hasImage: !!talk.image_url,
      hasExpertImage: !!firstExpert?.profile_image_url,
      imageUrl: absoluteImageUrl,
      imageWidth,
      imageHeight,
      expertName,
      descriptionLength: cleanDesc.length,
      prerenderUrl
    });

    const html = generateHtml({
      title: `${talk.title} - ${expertName} | 99expert`,
      description: cleanDesc.slice(0, 160),
      image: absoluteImageUrl,
      pageUrl: targetUrl,
      prerenderUrl: prerenderUrl,
      type: 'talk',
      imageWidth,
      imageHeight
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    log('error', 'Error fetching talk', { id, error: error.message, stack: error.stack });
    res.redirect(302, targetUrl);
  }
});

// Image transformation endpoint - resizes images to 1200x630 for social media
app.get('/transform', async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    log('info', 'Transforming image', { imageUrl });
    
    // Download the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 99expert-prerender/1.0)'
      }
    });

    // Use 'inside' fit to preserve entire image without cropping
    // This ensures text and important content are never cut off
    // The image will be fitted within 1200x630, and background padding will fill remaining space
    const image = sharp(response.data);
    
    // First, resize to fit inside 1200x630 (preserves aspect ratio, no cropping)
    const fittedImage = await image
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, {
        fit: 'inside', // Fit within dimensions, no cropping - preserves all content
        withoutEnlargement: false // Allow upscaling if image is smaller
      })
      .toBuffer();
    
    // Get the dimensions of the fitted image
    const fittedMetadata = await sharp(fittedImage).metadata();
    
    // Calculate padding needed to reach exactly 1200x630
    const paddingTop = Math.floor((OG_IMAGE_HEIGHT - fittedMetadata.height) / 2);
    const paddingBottom = OG_IMAGE_HEIGHT - fittedMetadata.height - paddingTop;
    const paddingLeft = Math.floor((OG_IMAGE_WIDTH - fittedMetadata.width) / 2);
    const paddingRight = OG_IMAGE_WIDTH - fittedMetadata.width - paddingLeft;
    
    // Extend with background color to fill exact dimensions
    const resizedImage = await sharp(fittedImage)
      .extend({
        top: paddingTop,
        bottom: paddingBottom,
        left: paddingLeft,
        right: paddingRight,
        background: { r: 26, g: 26, b: 46, alpha: 1 } // Dark background (matches 99expert brand)
      })
      .jpeg({ quality: 90, mozjpeg: true }) // High quality JPEG
      .toBuffer();

    // Set appropriate headers
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.setHeader('Content-Length', resizedImage.length);
    
    log('info', 'Image transformed successfully', { 
      originalUrl: imageUrl,
      size: resizedImage.length 
    });
    
    res.send(resizedImage);
  } catch (error) {
    log('error', 'Failed to transform image', { 
      imageUrl, 
      error: error.message 
    });
    
    // Return a 1x1 transparent pixel as fallback
    const fallbackImage = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    res.setHeader('Content-Type', 'image/gif');
    res.send(fallbackImage);
  }
});

// Health check endpoints (must come before catch-all)
// Always return success - server is ready to handle requests as soon as Express is set up
app.get('/health', (req, res) => {
  log('info', 'Health check requested', { path: '/health', ip: req.ip, ready: serverReady });
  // Always return 200 - Express is ready to handle requests
  res.status(200).json({ 
    status: 'ok', 
    ready: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint - return OK for health checks
app.get('/', (req, res) => {
  log('info', 'Root endpoint requested', { path: '/', ip: req.ip, userAgent: req.headers['user-agent'], ready: serverReady });
  // Always return 200 - Express is ready to handle requests
  res.status(200).json({ 
    status: 'ok', 
    service: 'prerender-server', 
    ready: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Fallback - redirect to main site (must be last)
app.get('*', (req, res) => {
  log('info', 'Fallback route - redirecting to main site', { path: req.path, url: req.url });
  res.redirect(302, BASE_URL);
});

// Error handling - keep process alive
process.on('uncaughtException', (error) => {
  log('error', 'Uncaught Exception', { 
    error: error.message, 
    stack: error.stack,
    name: error.name 
  });
  // Log but don't exit - let the server continue running
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', 'Unhandled Rejection', { 
    reason: reason?.toString() || String(reason),
    promise: promise?.toString() || String(promise)
  });
  // Log but don't exit - let the server continue running
});

// Keep the process alive - prevent accidental exits
process.on('exit', (code) => {
  log('info', 'Process exiting', { exitCode: code, ready: serverReady });
});

// Keep process alive - prevent it from exiting
setInterval(() => {
  // This keeps the event loop alive
  if (serverReady) {
    // Log heartbeat every 30 seconds to show we're alive
    // (commented out to reduce log noise, uncomment for debugging)
    // log('debug', 'Heartbeat', { uptime: process.uptime(), ready: serverReady });
  }
}, 30000);

// Ensure server stays alive
let server;

// Track server readiness - start as ready since Express can handle requests immediately
let serverReady = true;

log('info', 'Starting server', { port: PORT, nodeVersion: process.version, pid: process.pid });

try {
  // Start listening - server can accept connections immediately
  server = app.listen(PORT, '0.0.0.0', () => {
    serverReady = true;
    log('info', 'Server started successfully', { 
      port: PORT,
      address: `0.0.0.0:${PORT}`,
      healthCheck: `http://0.0.0.0:${PORT}/health`,
      rootEndpoint: `http://0.0.0.0:${PORT}/`,
      ready: true
    });
    
    // Log readiness immediately
    console.log('✅ Server is ready and listening');
  });
  
  // Server is ready to accept connections as soon as listen() is called
  // The callback just confirms it's bound to the port
  log('info', 'Server listen() called, ready to accept connections', { port: PORT });

  // Keep process alive
  server.on('error', (error) => {
    log('error', 'Server error event', { 
      error: error.message, 
      code: error.code,
      stack: error.stack 
    });
    // Don't exit on error, let it try to recover
  });

  server.on('listening', () => {
    serverReady = true;
    const addr = server.address();
    log('info', 'Server listening', { 
      address: addr,
      port: PORT,
      ready: true
    });
    // Immediate readiness signal
    console.log(`✅ Server listening on ${addr.address}:${addr.port}`);
  });

  server.on('close', () => {
    log('info', 'Server closed');
  });
} catch (error) {
  log('error', 'Failed to start server', { 
    error: error.message, 
    stack: error.stack 
  });
  process.exit(1);
}

// Graceful shutdown handling
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    log('warn', 'Shutdown already in progress', { signal });
    return;
  }
  isShuttingDown = true;
  
  log('info', 'Shutdown signal received', { signal, pid: process.pid });
  
  // Stop accepting new connections
  server.close(() => {
    log('info', 'HTTP server closed gracefully', { signal });
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds if connections don't close
  setTimeout(() => {
    log('error', 'Could not close connections in time, forcefully shutting down', { signal });
    process.exit(1);
  }, 10000);
}

// Handle termination signals
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received', { pid: process.pid });
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  log('info', 'SIGINT received', { pid: process.pid });
  gracefulShutdown('SIGINT');
});

// Log all process signals for debugging
process.on('SIGHUP', () => log('info', 'SIGHUP received'));
process.on('SIGUSR1', () => log('info', 'SIGUSR1 received'));
process.on('SIGUSR2', () => log('info', 'SIGUSR2 received'));

// Log process info on startup (at the very beginning)
log('info', 'Process starting', {
  pid: process.pid,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  env: {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV
  }
});
