import { runService } from "./service.js";
runService().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
