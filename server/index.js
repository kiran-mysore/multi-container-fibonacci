const config = require('./config');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres Client Setup
const { Pool } = require('pg');
const pgClient = new Pool({
  user: config.pgUser,
  host: config.pgHost,
  database: config.pgDatabase,
  password: config.pgPassword,
  port: config.pgPort,
});

pgClient.on('error', () => console.log('Lost Postgres connection'));

pgClient
  .query('CREATE TABLE IF NOT EXISTS fibonacci_results (number INT PRIMARY KEY, result BIGINT)')
  .catch(err => console.error('Error creating table:', err));

// Redis Client Setup (Pure v4 - NO legacy mode)
const redis = require('redis');

const redisClient = redis.createClient({
  socket: {
    host: config.redisHost,
    port: config.redisPort,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.log('Redis: Too many retries');
        return new Error('Too many retries');
      }
      const delay = Math.min(retries * 100, 3000);
      console.log(`Redis reconnecting in ${delay}ms`);
      return delay;
    }
  }
});

const publisherClient = redisClient.duplicate();

// Connect Redis clients
let redisReady = false;

(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Redis client connected');
    await publisherClient.connect();
    console.log('✅ Redis publisher connected');
    redisReady = true;
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err);
  }
})();

redisClient.on('error', (err) => console.log('Redis Client Error:', err));
publisherClient.on('error', (err) => console.log('Redis Publisher Error:', err));

// Express route handlers
app.get('/results/all', async (req, res) => {
  try {
    const results = await pgClient.query('SELECT * FROM fibonacci_results ORDER BY number');
    res.send(results.rows);
  } catch (err) {
    console.error('Error fetching results from Postgres:', err);
    res.status(500).send({ error: 'Error fetching results' });
  }
});

app.get('/results/current', async (req, res) => {
  try {
    if (!redisReady) {
      return res.status(503).send({ error: 'Redis not ready yet' });
    }
    
    const results = await redisClient.hGetAll('fibonacci_results');  // Direct call, no .v4
    res.send(results || {});
  } catch (err) {
    console.error('Error fetching current results from Redis:', err);
    res.status(500).send({ error: 'Error fetching current results', details: err.message });
  }
});

app.post('/calculate/results', async (req, res) => {
  const number = parseInt(req.body.index);
  
  if (isNaN(number)) {
    return res.status(400).send({ error: 'Invalid number' });
  }
  
  if (number > 40) {
    return res.status(422).send({ error: 'Number too high' });
  }
  
  if (number < 0) {
    return res.status(400).send({ error: 'Number must be non-negative' });
  }

  try {
    if (!redisReady) {
      return res.status(503).send({ error: 'Redis not ready yet' });
    }
    
    // Set initial value in Redis
    await redisClient.hSet('fibonacci_results', number.toString(), 'Nothing yet!');
    
    // Publish job to worker
    await publisherClient.publish('fibonacci_jobs', number.toString());
    
    // Store in Postgres
    await pgClient.query(
      'INSERT INTO fibonacci_results(number, result) VALUES($1, $2) ON CONFLICT (number) DO NOTHING',
      [number, 0]
    );
    
    res.send({ working: true });
  } catch (err) {
    console.error('Error submitting job:', err);
    res.status(500).send({ error: 'Error submitting job', details: err.message });
  }
});

app.listen(5000, err => {
  if (err) {
    console.error('Error starting server:', err);
  } else {
    console.log('🚀 Server listening on port 5000');
  }
});