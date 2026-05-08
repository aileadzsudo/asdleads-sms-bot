const { Store } = require("./store");
const { PostgresStore } = require("./postgresStore");

async function createStore(config) {
  if (config.databaseUrl) {
    const store = new PostgresStore(config.databaseUrl);
    await store.init();
    console.log("Storage initialized: postgres");
    return store;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production. Add it to the app service variables, not only the Postgres service.");
  }
  console.log("Storage initialized: json");
  return new Store(config.dataFile);
}

module.exports = { createStore };
