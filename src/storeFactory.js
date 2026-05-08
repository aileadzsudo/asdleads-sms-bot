const { Store } = require("./store");
const { PostgresStore } = require("./postgresStore");

async function createStore(config) {
  if (config.databaseUrl) {
    const store = new PostgresStore(config.databaseUrl);
    await store.init();
    return store;
  }
  return new Store(config.dataFile);
}

module.exports = { createStore };
