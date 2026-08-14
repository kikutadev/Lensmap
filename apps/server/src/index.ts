import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.error(error);
  process.exitCode = 1;
}
