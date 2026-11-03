// constants.ts

export const DEFAULT_TIMEOUT = 240000; // in milliseconds
export const DATE_TIME_ISO_FORMAT = "YYYY-MM-DDTHH:mm:ss.SSSZ";
export const DATE_FORMAT = "YYYY-MM-DD";

export const CLIENT_API_URL = "https://client-api.8slp.net/v1";
export const APP_API_URL = "https://app-api.8slp.net/";
export const AUTH_URL = "https://auth-api.8slp.net/v1/tokens";
// Eight Sleep's own Android-app client id and secret: public values that the open-source projects credited in the
// README use too. They are not anyone's private key, and they can change if Eight Sleep changes its app.
export const KNOWN_CLIENT_ID = "0894c7f33bb94800a03f1f4df13a4f38";
export const KNOWN_CLIENT_SECRET = "f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76";

export const TOKEN_TIME_BUFFER_SECONDS = 120;

export const DEFAULT_API_HEADERS = {
  "content-type": "application/json",
  "connection": "keep-alive",
  "user-agent": "Android App",
  "accept-encoding": "gzip",
  "accept": "application/json",
  // no "host" here: fetch sets the right one per URL (app-api vs client-api)
};

export const DEFAULT_AUTH_HEADERS = {
  "content-type": "application/json",
  "user-agent": "Android App",
  "accept-encoding": "gzip",
  "accept": "application/json",
};

export const POSSIBLE_SLEEP_STAGES = ["bedTimeLevel", "initialSleepLevel", "finalSleepLevel"];

// the temperature tables live in src/lib/bedTemp.ts (the screens use them too)
export { RAW_TO_CELSIUS_MAP, RAW_TO_FAHRENHEIT_MAP } from "~/lib/bedTemp";
