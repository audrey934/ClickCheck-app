// clickcheck server
// for now it just serves the pages in /public and has a /health route
// the api part comes later

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

// quick route to check the server is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: SERVER_NAME });
});

app.listen(PORT, () => {
  console.log(`ClickCheck running on http://localhost:${PORT}`);
});

