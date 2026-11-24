// Returns the visitor's approximate city from Vercel's IP geolocation headers.
module.exports = (req, res) => {
  const h = req.headers;
  const dec = v => { try { return decodeURIComponent(v || ''); } catch { return v || ''; } };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    city: dec(h['x-vercel-ip-city']),
    region: h['x-vercel-ip-country-region'] || '',
    country: h['x-vercel-ip-country'] || '',
  }));
};
