import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Ensure cache directory exists
const CACHE_DIR = path.join(__dirname, '.cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Helper to sanitize name for safe caching filename
function getCachePath(name) {
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  return path.join(CACHE_DIR, `${safeName}.html`);
}

// Normalize 'Lastname, Firstname' to 'Firstname Lastname'
function normalizeName(name) {
  if (!name) return '';
  const parts = name.split(',');
  if (parts.length === 2) {
    return `${parts[1].trim()} ${parts[0].trim()}`;
  }
  return name.trim();
}

// Fetch helper with file-system caching and retry logic
async function fetchWithCache(name) {
  const cachePath = getCachePath(name);
  
  // Check if file is in cache
  if (fs.existsSync(cachePath)) {
    try {
      const cachedContent = fs.readFileSync(cachePath, 'utf-8');
      return cachedContent;
    } catch (err) {
      console.error(`Error reading cache for ${name}:`, err);
    }
  }
  
  // If not cached, fetch from network
  const url = `https://elaba.mb.vu.lt/fsf/?aut=${encodeURIComponent(name)}`;
  console.log(`Fetching from network: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(15000) // 15s timeout
    });
    
    if (!response.ok) {
      throw new Error(`eLABa HTTP error: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Write to cache
    fs.writeFileSync(cachePath, html, 'utf-8');
    
    // Slight sleep to avoid pounding the university server
    await new Promise(resolve => setTimeout(resolve, 150));
    
    return html;
  } catch (error) {
    console.error(`Error fetching page for ${name}:`, error);
    return '';
  }
}

// Check if an author has a valid eLABa page with publications
function parsePageExists(html) {
  if (!html) return false;
  // A valid page has a table with publication rows (contains table and tr)
  return html.toLowerCase().includes('<table') && html.toLowerCase().includes('<tr>');
}

// Parse an author's page for publication rows and extract details/co-authors
function parsePublicationsAndCoauthors(html, currentAuthorName) {
  const result = {
    exists: false,
    coauthors: [],
    publications: []
  };

  if (!parsePageExists(html)) {
    return result;
  }

  result.exists = true;
  
  // Find all table rows
  // eLABa rows look like: <tr><td>Eil. Nr.</td><td>...</td></tr>
  const rowRegex = /<tr>\s*<td>\d+<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  const authorTagRegex = /<author[^>]*>([^<]+)<\/author>/gi;
  
  const coauthorSet = new Set();
  const normalizedCurrentAuthor = currentAuthorName.toLowerCase().trim();
  let rowMatch;
  let pubCount = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    pubCount++;
    const pubHtml = rowMatch[1].trim();
    
    // Extract authors inside this specific publication row
    const authorsInRow = [];
    let authorMatch;
    // We instantiate a fresh regex for each row to scrape it correctly
    const freshAuthorRegex = /<author[^>]*>([^<]+)<\/author>/gi;
    
    while ((authorMatch = freshAuthorRegex.exec(pubHtml)) !== null) {
      const rawName = authorMatch[1].trim();
      const normName = normalizeName(rawName);
      authorsInRow.push(normName);
      
      // If it's not the main author, add it to co-authors
      if (normName.toLowerCase().trim() !== normalizedCurrentAuthor) {
        coauthorSet.add(normName);
      }
    }

    // Clean up author tags and punctuation/whitespace to extract publication title/details
    let detailsText = pubHtml.replace(/<author[^>]*>[^<]+<\/author>/gi, '');
    detailsText = detailsText.replace(/^[\s;.,]+/g, '').trim(); // Remove leading punctuation/spacing
    
    result.publications.push({
      id: pubCount,
      authors: authorsInRow,
      details: detailsText
    });
  }

  result.coauthors = Array.from(coauthorSet);
  return result;
}

// Concurrency limiter for verifying co-authors in parallel
async function limitConcurrency(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    if (limit <= tasks.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// API: Search if an author exists
app.get('/api/search', async (req, res) => {
  const authorName = req.query.name;
  if (!authorName) {
    return res.status(400).json({ error: 'Name parameter is required' });
  }

  try {
    const html = await fetchWithCache(authorName);
    const exists = parsePageExists(html);
    return res.json({ name: authorName, exists });
  } catch (error) {
    console.error(`Search failed for ${authorName}:`, error);
    return res.status(500).json({ error: 'Failed to search author' });
  }
});

// API: Get complete details for an author, verifying that co-authors have their own eLABa pages
app.get('/api/author', async (req, res) => {
  const authorName = req.query.name;
  if (!authorName) {
    return res.status(400).json({ error: 'Name parameter is required' });
  }

  try {
    const html = await fetchWithCache(authorName);
    const data = parsePublicationsAndCoauthors(html, authorName);
    
    if (!data.exists) {
      return res.json({ name: authorName, exists: false, coauthors: [], publications: [] });
    }

    // Verify each co-author to see if they have their own eLABa page
    // Using concurrency limit of 5 to protect the university server
    const verificationTasks = data.coauthors.map(coauthor => async () => {
      try {
        const coauthorHtml = await fetchWithCache(coauthor);
        const exists = parsePageExists(coauthorHtml);
        return { name: coauthor, exists };
      } catch (err) {
        console.error(`Failed verifying co-author ${coauthor}:`, err);
        return { name: coauthor, exists: false };
      }
    });

    const verifications = await limitConcurrency(verificationTasks, 5);
    
    // Filter co-authors: only keep those who exist in eLABa
    const validatedCoauthors = verifications
      .filter(v => v.exists)
      .map(v => v.name);

    return res.json({
      name: authorName,
      exists: true,
      coauthors: validatedCoauthors,
      publications: data.publications
    });
  } catch (error) {
    console.error(`Details fetch failed for ${authorName}:`, error);
    return res.status(500).json({ error: 'Failed to fetch author details' });
  }
});

app.listen(PORT, () => {
  console.log(`VU Authors Explorer backend running at http://localhost:${PORT}`);
});
