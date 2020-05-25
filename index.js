const express = require("express")
const http = require("http")
const redis = require("redis")
const mongoose = require('mongoose');

const env = require("./env")

const app = express();
server = http.createServer(app);

// In node you can't listen for all events so we just list them out :(
const mongooseEvents = [
  'close',
  'connected',
  'disconnected',
  'disconnecting',
  'error',
  'fullsetup',
  'all',
  'reconnected',
  'reconnectFailed',
].forEach(mongooseEvent => {
  mongoose.connection.on(mongooseEvent, (err) => {
    // TODO: send errors to your error tracker if needed
    console.log(`mongoose client event: ${mongooseEvent}. ${err ? `${err}`: ''}`);
  });
});

let numberOfMongooseRetries = 1;
const THIRTY_SECONDS = 30000;
const MAX_DELAY_TO_RECONNECT = THIRTY_SECONDS;
async function connectToMongoose() {
  console.log(`attempt ${numberOfMongooseRetries} to connect to mongo`);
  try {
    await mongoose.connect(env.MONGO_DB_CONNECTION_STRING,  { useNewUrlParser: true })
  }
  catch (err) {
    // TODO: send errors to your error tracker if needed
    console.error('failed to intially connect to mongo', err);
    const timeUntilRetrying = Math.min(MAX_DELAY_TO_RECONNECT, (Math.pow(2, numberOfMongooseRetries) * 1000));
    console.log(`will try reconnecting in ${timeUntilRetrying / 1000} seconds`);

    setTimeout(() => {
      numberOfMongooseRetries++;
      connectToMongoose();
    }, timeUntilRetrying);
  }
}
connectToMongoose();

const redisOptions = { host: env.REDIS_HOST, port: env.REDIS_PORT };
if (env.NODE_ENV === 'production') {
  redisOptions['password'] = env.REDIS_PASSWORD;
}
const redisClient = redis.createClient(redisOptions);
const redisEvents = [
  'ready',
  'connect',
  'end',
  'error',
  'warning',
].forEach(redisEvent => {
  redisClient.on(redisEvent, (err) => {
    // TODO: send errors to your error tracker if needed
    console.log(`redis client event: ${redisEvent}. ${err ? err: ''}`);
  });
});
redisClient.on('reconnecting', (data) => {
  console.error(`redis client waited ${data.delay}ms. attempt ${data.attempt} to reconnect to server`)
});

let mongooseConnected = false;
let redisConnected = false;

function tryToStartTheServer() {
  if (mongooseConnected && redisConnected) {
    console.log("mongoose and redis are connected. LETS GO!");
    app.emit('ready');
  }
}

const mongooseAlreadyConnected = mongoose.connection.readyState === 1;
if (mongooseAlreadyConnected) {
  mongooseConnected = true;
  tryToStartTheServer();
} else {
  mongoose.connection.once('open', () => {
    mongooseConnected = true;
    tryToStartTheServer();
  });
}

if (redisClient.connected) {
  redisConnected = true;
  tryToStartTheServer();
} else {
  redisClient.once('ready', () => {
    redisConnected = true;
    tryToStartTheServer();
  });
}

process.on('SIGINT', () => {
  console.log('SIGINT signal received.');
  let mongoClientExited = false;
  let redisClientExited = false;
  let expressServerExited = false;

  function attemptToExitProcess() {
    if (redisClientExited && mongoClientExited && expressServerExited) {
      console.log('All connections have cleanly closed. Exiting process...');
      process.exit(0);
    }
  }

  function attemptToCloseMongo() {
    console.log('Attempting to close mongoose client...')
    mongoose.connection.close(() => {
      console.log('Mongoose default connection disconnected through app termination');
      mongoClientExited = true;
      attemptToExitProcess();
    });    
  }

  function attemptToCloseRedis() {
    console.log('Attempting to close redis client...')
    redisClient.quit(() => {
      console.log('Redis default connection disconnected through app termination');
      redisClientExited = true;
      attemptToExitProcess();
    })    
  }

  console.log('Attempting to close express HTTP server...')
  server.close(() => {
    console.log('Express HTTP server closed.');
    expressServerExited = true;
    attemptToCloseRedis();
    attemptToCloseMongo();
  });

  const FIFTEEN_SECONDS = 15000;
  const TIME_UNTIL_FORCED_PROCESS_EXIT = FIFTEEN_SECONDS;
  setTimeout(() => {
    if (!mongoClientExited) console.error("Mongoose client did not close in time.");
    if (!redisClientExited) {
      console.error("Redis client did not close in time. Forcibly shutting it down.");
      redisClient.end(true);
    }
    if (!expressServerExited) console.error("Express HTTP server did not close in time.");
    console.error("Forcing the process to end.");
    process.exit(0);
  }, TIME_UNTIL_FORCED_PROCESS_EXIT);
});

app.on('ready', () => {
  console.log(`Starting http server on port ${env.HTTP_PORT}...`);
  server.listen(env.HTTP_PORT, () => {
    console.log(`Started http server on port ${env.HTTP_PORT}. :)`);
  });
});