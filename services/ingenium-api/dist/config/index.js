export const config = {
    port: parseInt(process.env.INGENIUM_API_PORT ?? "4097", 10),
    rateLimit: parseInt(process.env.INGENIUM_API_RATE_LIMIT ?? "100", 10),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    coreDbPath: process.env.INGENIUM_CORE_DB_PATH ?? process.cwd(),
};
