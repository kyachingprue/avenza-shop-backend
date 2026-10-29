const http = require("node:http");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const { app, corsOptions } = require("./app");
const env = require("./config/env");
const prisma = require("./db/prisma");
const { attachSockets } = require("./socket");

async function start() {
  await prisma.$connect();
  console.log("Database connected");

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: corsOptions,
    maxHttpBufferSize: 16 * 1024
  });
  io.engine.use(cookieParser());
  attachSockets(io);

  server.listen(env.PORT, () => {
    console.log(`Backend listening on port ${env.PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received; shutting down`);
    io.close();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = app;

if (require.main === module) {
  start().catch(async (error) => {
    console.error("Backend startup failed", error.message);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
}
