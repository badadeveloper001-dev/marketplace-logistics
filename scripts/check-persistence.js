const { checkPostgresConnection } = require("../src/db");

async function main() {
  const postgres = await checkPostgresConnection();
  const durable = postgres.configured && postgres.connected;

  console.log("Persistence Check");
  console.log("-----------------");
  console.log(`PostgreSQL configured: ${postgres.configured ? "yes" : "no"}`);
  console.log(`PostgreSQL connected:  ${postgres.connected ? "yes" : "no"}`);
  console.log(`Durable mode:          ${durable ? "enabled" : "disabled"}`);

  if (postgres.error) {
    console.log(`Reason:                ${postgres.error}`);
  }

  process.exit(durable ? 0 : 1);
}

main().catch((error) => {
  console.error("Persistence check failed:", error.message);
  process.exit(1);
});
