const redisOptions = require('./redisConfig');
const config = require('./pgConfig'); 
const redis = require('redis');
const { Pool } = require('pg');

const pgClient = new Pool({
  user: config.pgUser,
  host: config.pgHost,
  database: config.pgDatabase,
  password: config.pgPassword,
  port: config.pgPort,
});

pgClient.on('error', (err) => console.error('Worker: Postgres error:', err));



// Redis Client (Pure v4)
const redisClient = redis.createClient({
  socket: {
    host: redisOptions.redisHost,
    port: redisOptions.redisPort,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        return new Error('Too many retries');
      }
      const delay = Math.min(retries * 100, 3000);
      console.log(`Worker: Redis reconnecting in ${delay}ms`);
      return delay;
    }
  }
});

const subscribeClient = redisClient.duplicate();

// Efficient Fibonacci - O(n)
function calculateFibonacci(n) {
  if (n < 2) return n;
  
  let a = 0;
  let b = 1;
  
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  
  return b;
}

// Connect and start listening
(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Worker: Redis client connected');
    
    await subscribeClient.connect();
    console.log('✅ Worker: Subscribe client connected');
    
    // Subscribe to fibonacci_jobs channel
    await subscribeClient.subscribe('fibonacci_jobs', async (message) => {
      try {
        const number = parseInt(message);
        console.log(`📥 Worker: Received job for Fibonacci(${number})`);
        
        const startTime = Date.now();
        const result = calculateFibonacci(number);
        const duration = Date.now() - startTime;
        
        // Store result in Redis (direct call, no .v4)
        await redisClient.hSet('fibonacci_results', message, result.toString());

        // UPDATE: Also store in Postgres
        await pgClient.query(
          'UPDATE fibonacci_results SET result = $1 WHERE number = $2',
          [result, number]
        );
        
        console.log(`✅ Worker: Fibonacci(${number}) = ${result} (${duration}ms)`);
      } catch (err) {
        console.error('❌ Worker: Error processing message:', err);
      }
    });
    
    console.log('🎧 Worker: Listening for jobs on fibonacci_jobs channel');
    
  } catch (err) {
    console.error('❌ Worker: Failed to start:', err);
    process.exit(1);
  }
})();

redisClient.on('error', (err) => console.error('Worker: Redis error:', err));
subscribeClient.on('error', (err) => console.error('Worker: Subscribe error:', err));

process.on('SIGINT', async () => {
  console.log('Worker: Shutting down...');
  await subscribeClient.quit();
  await redisClient.quit();
  await pgClient.end();
  process.exit(0);
});
