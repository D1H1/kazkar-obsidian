// Manual testing: `npx tsx test/serve-mock.ts` then set the plugin's Server URL to the printed URL.
import { GOOD_KEY, startMockServer } from "./mock-server";
startMockServer().then((s) => console.log(`mock kazkar at ${s.url}  key: ${GOOD_KEY}`));
