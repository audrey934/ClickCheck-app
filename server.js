// clickcheck server
// serves the frontend from /public and has one api route (/api/check)
// that asks google safe browsing and virustotal about a url.
// the keys live in .env so they never reach the browser or github.
// needs node 18+ because I'm using the built in fetch

require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;
// server name comes from .env, falls back to the machine's hostname
const SERVER_NAME = process.env.SERVER_NAME || os.hostname();

app.use(express.json());

// put the server name in a header on every response
// this is how I'll prove later that the load balancer hits both servers
app.use((req, res, next) => {
  res.set('X-Served-By', SERVER_NAME);
  next();
});

// serve everything in the public folder (html, css, js)
app.use(express.static(path.join(__dirname, 'public')));

// small helper to wait, used when polling virustotal
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// people paste links without http:// so I add it myself,
// then check it's actually a valid http(s) url. returns null if not
function normalizeUrl(input) {
  let candidate = String(input || '').trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    // a hostname with no dot (like "hello") is not a real link
    if (!parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// ---- api 1: google safe browsing ----
// docs: https://developers.google.com/safe-browsing/v4
// I send the url and google answers with a list of matches
// (empty list = not in their threat database)
async function checkGoogleSafeBrowsing(url) {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) {
    // no key set, don't crash, just report this source as unavailable
    return { available: false, error: 'API key not configured' };
  }

  const endpoint =
    'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + key;

  // this body format is what the v4 api expects
  const body = {
    client: { clientId: 'clickcheck', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING', // this one is phishing
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { available: false, error: `Safe Browsing responded ${res.status}` };
  }

  const data = await res.json();
  const matches = data.matches || [];
  return {
    available: true,
    flagged: matches.length > 0,
    // Set removes duplicates if the same threat type appears twice
    threats: [...new Set(matches.map((m) => m.threatType))],
  };
}

// ---- api 2: virustotal ----
// docs: https://docs.virustotal.com/reference/overview
// works in 2 steps: submit the url, then poll for the result.
// free tier = 4 requests per minute so I handle the 429 error too
async function checkVirusTotal(url) {
  const key = process.env.VIRUSTOTAL_KEY;
  if (!key) {
    return { available: false, error: 'API key not configured' };
  }

  // step 1: submit the url for scanning
  const submit = await fetch('https://www.virustotal.com/api/v3/urls', {
    method: 'POST',
    headers: {
      'x-apikey': key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ url }),
  });

  if (submit.status === 429) {
    // hit the free tier limit
    return {
      available: false,
      error: 'VirusTotal rate limit reached (4 checks/minute). Wait a moment and retry.',
    };
  }
  if (!submit.ok) {
    return { available: false, error: `VirusTotal responded ${submit.status}` };
  }

  const { data } = await submit.json();
  const analysisId = data.id;

  // step 2: keep checking until the analysis is done (I give it ~8 seconds max)
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(2000);
    const res = await fetch(
      `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
      { headers: { 'x-apikey': key } }
    );
    if (!res.ok) continue;

    const json = await res.json();
    if (json.data.attributes.status === 'completed') {
      const s = json.data.attributes.stats;
      return {
        available: true,
        malicious: s.malicious,
        suspicious: s.suspicious,
        harmless: s.harmless,
        undetected: s.undetected,
        totalEngines: s.malicious + s.suspicious + s.harmless + s.undetected,
      };
    }
  }

  // took too long, give up nicely instead of hanging forever
  return {
    available: false,
    error: 'VirusTotal analysis still in progress — retry in a minute.',
  };
}

// quick route to check the server is alive (the load balancer will use this)
// simple in-memory cache so the same link doesn't get sent to the apis
// twice in a row. virustotal only allows 4 requests a minute on the free
// key, so this keeps me under the limit and makes repeat scans instant
const CACHE_TTL_MS = 10 * 60 * 1000; // results count as fresh for 10 min
const CACHE_MAX = 500;               
const cache = new Map();

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  // too old, bin it and treat as a miss
  if (Date.now() - hit.storedAt > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.result;
}

function cacheSet(url, result) {
  // if it's full drop the oldest one (a Map remembers insertion order)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, { storedAt: Date.now(), result });
}
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: SERVER_NAME });
});

// the main route: frontend posts a url here and gets a verdict back
app.post('/api/check', async (req, res) => {
  const url = normalizeUrl(req.body.url);
  if (!url) {
    return res.status(400).json({
      error: 'Please enter a valid URL, e.g. example.com or https://example.com',
    });
  }
// already checked this link recently, so send the saved answer back
// instead of calling both apis again
  const cached = cacheGet(url);
  if (cached) {
    return res.json({ ...cached, cached: true, servedBy: SERVER_NAME });
  }
  try {
    // ask both apis at the same time instead of one after the other
    const [gsb, vt] = await Promise.all([
      checkGoogleSafeBrowsing(url),
      checkVirusTotal(url),
    ]);

    // if both failed there's nothing useful to show
    if (!gsb.available && !vt.available) {
      return res.status(502).json({
        error: 'Both security services are unavailable right now. Please try again shortly.',
        details: { googleSafeBrowsing: gsb.error, virusTotal: vt.error },
      });
    }

    // turn the two answers into one verdict + a score out of 100
    let verdict = 'safe';
    let score = 0;

    if (vt.available && vt.totalEngines > 0) {
      // percentage of engines that flagged it, x4 so even a few
      // detections push the score up (suspicious counts half)
      score = Math.min(
        100,
        Math.round(((vt.malicious + vt.suspicious * 0.5) / vt.totalEngines) * 400)
      );
    }
    // if google flags it that's serious, force the score high
    if (gsb.available && gsb.flagged) score = Math.max(score, 90);

    if ((gsb.available && gsb.flagged) || (vt.available && vt.malicious > 0)) {
      verdict = 'dangerous';
    } else if (vt.available && vt.suspicious > 0) {
      verdict = 'suspicious';
    }

    const result = {
      url,
      verdict,
      score,
      checkedAt: new Date().toISOString(),
      sources: { googleSafeBrowsing: gsb, virusTotal: vt },
    };

    cacheSet(url, result);
    res.json({ ...result, cached: false, servedBy: SERVER_NAME });
 
  } catch (err) {
    // last resort so the app never sends a raw crash to the user
    console.error('Check failed:', err);
    res.status(500).json({ error: 'Something went wrong while scanning. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`ClickCheck running on http://localhost:${PORT} (${SERVER_NAME})`);
});

