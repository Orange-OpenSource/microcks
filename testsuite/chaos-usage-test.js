import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Microcks Chaos usage test, launched separately from the functional testsuite:
//
//   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=chaos-storm-report.html k6 run chaos-usage-test.js
//
// It is self-sufficient: it first imports the two mocked APIs it needs (only when missing) and then imports the
// Chaos experiment used by the storm - existing definitions are reused (updated, re-anchored), never deleted.
//
// The storm runs a realistic 10-minute failure sequence on GET /pastry. The load also hits two clean baselines
// (another operation of the same service and the Petstore API) so the dashboard shows what the storm does to the
// target versus unaffected APIs. Requires k6 >= 0.49 for the web dashboard; the exported HTML is a standalone
// interactive copy of it.
//
// The storm is a single experiment made of one track (layer) per intention, each owning its own window. Two extra
// layers target the Petstore API with windows OVERLAPPING the pastry ones, so both services degrade at the same
// time during parts of the run:
//
//   API Pastry - 2.0 (GET /pastry):
//     0 - 2.5min    latency-degradation   12-keyframe ramp, 50ms -> 1500ms
//     2.5 - 5min    rate-limiting-429     synthetic 429, graduated probability ramp 15% -> 100%
//     5 - 7.5min    outage-5xx            escalating 5xx share, statuses rotating 500 -> 502 -> 503
//     7.5 - 10min   timeout-blackhole     30s latency, above the 10s client timeout
//   Petstore API (GET /v2/pet/findByStatus) - overlap windows with the pastry storm:
//     3 - 5min      petstore-rate-limiting-429   overlapping the pastry 429 layer
//     5.5 - 8min    petstore-outage-5xx          overlapping the pastry 5xx layer and the timeout phase
//   GET /pastry/{name} stays a clean control for the whole run.

// --- Configuration (environment overridable) ---
const HOST = __ENV.HOST || 'localhost';
const PORT = __ENV.PORT || '8080';
const BASE_URL = __ENV.BASE_URL || `http://${HOST}:${PORT}`;
const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || `http://${HOST}:18080`;
// An already obtained access token; when empty, the script tries the default Microcks service account
// (and simply runs unauthenticated when Keycloak is not enabled, eg devmode or uber distributions).
const CHAOS_TOKEN = __ENV.CHAOS_TOKEN || '';
// Directory holding the sample artifacts to import (APIPastry-openapi.yaml and PetstoreAPI-collection.json).
const SAMPLES_DIR = __ENV.SAMPLES_DIR || '../samples';
const VUS = Number(__ENV.VUS || 3);
const DURATION = __ENV.DURATION || '10m';
const WAIT_TIME = parseFloat(__ENV.WAIT_TIME) || 0.2;
// Client timeout kept SHORTER than the timeout-phase latency (30s) so the last phase is observed as real timeouts.
const HTTP_TIMEOUT = __ENV.HTTP_TIMEOUT || '10s';
const SYNTHETIC_BODY = __ENV.SYNTHETIC_BODY || 'chaos-k6-synthetic-error';
// Threshold above which a successful storm response counts as degraded.
const DEGRADED_MS = Number(__ENV.DEGRADED_MS || 500);

export const options = {
  vus: VUS,
  duration: DURATION,
  // No thresholds on purpose: the storm deliberately degrades the target and the dashboard tells the story.
};

// --- The three APIs under load, all preloaded in a default Microcks instance ---
const API_STORM = {
  label: 'GET /pastry',
  service: 'API Pastry - 2.0',
  url: '/rest/API+Pastry+-+2.0/2.0.0/pastry',
};
const API_ITEM = {
  label: 'GET /pastry/{name}',
  service: 'API Pastry - 2.0',
  url: '/rest/API+Pastry+-+2.0/2.0.0/pastry/Eclair%20Cafe',
};
const API_PETSTORE = {
  label: 'GET /v2/pet/findByStatus',
  service: 'Petstore API',
  url: '/rest/Petstore+API/1.0/v2/pet/findByStatus?status=available&user_key=70f735676ec46351c6699c4bb767878a',
};

// --- Custom metrics surfaced by the web dashboard ---
const stormRequests = new Counter('storm_requests');
const stormDuration = new Trend('storm_duration');
const stormRateLimited = new Rate('storm_rate_limited');
const stormServerErrors = new Rate('storm_server_errors');
const stormTimeouts = new Rate('storm_timeouts');
const stormSlow = new Rate('storm_slow');
const baselineItemRequests = new Counter('baseline_item_requests');
const baselineItemDuration = new Trend('baseline_item_duration');
const petstoreRequests = new Counter('petstore_requests');
const petstoreDuration = new Trend('petstore_duration');
const petstoreRateLimited = new Rate('petstore_rate_limited');
const petstoreServerErrors = new Rate('petstore_server_errors');

// --- The storm experiment: one track (layer) per intention, each owning its own window ---
const STORM_DURATION_MS = 600000;
const STORM = {
  name: 'k6-degradation-storm',
  description: 'k6 chaos usage test - latency degradation, 429 and 5xx layers with cross-service overlaps then timeouts over 10 minutes',
  durationMs: STORM_DURATION_MS,
};

/** Build the JSON payload of the storm experiment for POST /api/chaos/experiments. */
function stormPayload() {
  return {
    name: STORM.name,
    description: STORM.description,
    durationMs: STORM.durationMs,
    tracks: [
      // Layer 1 - latency degradation: a fine 12-keyframe ramp inside its own window.
      {
        id: 'latency-degradation',
        serviceName: API_STORM.service,
        operationName: API_STORM.label,
        startMs: 0,
        endMs: 150000,
        probability: { keyframes: [{ timeMs: 0, value: 1 }] },
        modifier: {
          type: 'LATENCY',
          latencyMs: {
            keyframes: [
              { timeMs: 0, value: 50 },
              { timeMs: 12500, value: 80 },
              { timeMs: 25000, value: 120 },
              { timeMs: 37500, value: 170 },
              { timeMs: 50000, value: 230 },
              { timeMs: 62500, value: 300 },
              { timeMs: 75000, value: 380 },
              { timeMs: 87500, value: 480 },
              { timeMs: 100000, value: 600 },
              { timeMs: 112500, value: 750 },
              { timeMs: 125000, value: 950 },
              { timeMs: 137500, value: 1500 },
            ],
          },
        },
      },
      // Layer 2 - rate limiting: synthetic 429s with a graduated probability ramp inside its window.
      {
        id: 'rate-limiting-429',
        serviceName: API_STORM.service,
        operationName: API_STORM.label,
        startMs: 150000,
        endMs: 300000,
        probability: {
          keyframes: [
            { timeMs: 0, value: 0.15 },
            { timeMs: 170000, value: 0.4 },
            { timeMs: 200000, value: 0.6 },
            { timeMs: 230000, value: 0.8 },
            { timeMs: 260000, value: 1 },
          ],
        },
        modifier: {
          type: 'HTTP_ERROR',
          statusCode: { keyframes: [{ timeMs: 0, value: 429 }] },
          responseBody: SYNTHETIC_BODY,
        },
      },
      // Layer 3 - outage: an escalating share of 5xx errors, statuses rotating 500 -> 502 -> 503.
      {
        id: 'outage-5xx',
        serviceName: API_STORM.service,
        operationName: API_STORM.label,
        startMs: 300000,
        endMs: 450000,
        probability: {
          keyframes: [
            { timeMs: 0, value: 0.3 },
            { timeMs: 330000, value: 0.6 },
            { timeMs: 360000, value: 0.85 },
            { timeMs: 390000, value: 1 },
          ],
        },
        modifier: {
          type: 'HTTP_ERROR',
          statusCode: {
            keyframes: [
              { timeMs: 0, value: 500 },
              { timeMs: 360000, value: 502 },
              { timeMs: 410000, value: 503 },
            ],
          },
          responseBody: SYNTHETIC_BODY,
        },
      },
      // Layer 4 - timeout: latency far above the client timeout so requests abort.
      {
        id: 'timeout-blackhole',
        serviceName: API_STORM.service,
        operationName: API_STORM.label,
        startMs: 450000,
        endMs: 600000,
        probability: { keyframes: [{ timeMs: 0, value: 1 }] },
        modifier: { type: 'LATENCY', latencyMs: { keyframes: [{ timeMs: 0, value: 30000 }] } },
      },
      // Layer 5 - cross-service rate limiting: 429s on the Petstore overlapping the pastry 429 layer.
      {
        id: 'petstore-rate-limiting-429',
        serviceName: API_PETSTORE.service,
        operationName: API_PETSTORE.label,
        startMs: 180000,
        endMs: 300000,
        probability: {
          keyframes: [
            { timeMs: 0, value: 0.2 },
            { timeMs: 210000, value: 0.5 },
            { timeMs: 240000, value: 0.8 },
            { timeMs: 270000, value: 1 },
          ],
        },
        modifier: {
          type: 'HTTP_ERROR',
          statusCode: { keyframes: [{ timeMs: 0, value: 429 }] },
          responseBody: SYNTHETIC_BODY,
        },
      },
      // Layer 6 - cross-service outage: 5xx on the Petstore overlapping the pastry 5xx layer and the timeout phase.
      {
        id: 'petstore-outage-5xx',
        serviceName: API_PETSTORE.service,
        operationName: API_PETSTORE.label,
        startMs: 330000,
        endMs: 480000,
        probability: {
          keyframes: [
            { timeMs: 0, value: 0.25 },
            { timeMs: 360000, value: 0.6 },
            { timeMs: 400000, value: 0.9 },
            { timeMs: 430000, value: 1 },
          ],
        },
        modifier: {
          type: 'HTTP_ERROR',
          statusCode: { keyframes: [{ timeMs: 0, value: 503 }, { timeMs: 400000, value: 500 }] },
          responseBody: SYNTHETIC_BODY,
        },
      },
    ],
  };
}

/** Build the HTTP params carrying the optional bearer token and/or a JSON content type. */
function chaosParams(token, json) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  return Object.keys(headers).length > 0 ? { headers: headers } : {};
}

/** Read a sample artifact at init scope (open() is only available in the global scope); null when unavailable. */
function readSample(filename) {
  try {
    return open(`${SAMPLES_DIR}/${filename}`);
  } catch (e) {
    console.warn(`Sample file ${SAMPLES_DIR}/${filename} is not readable: ${e}`);
    return null;
  }
}

// The two sample artifacts backing the storm target and the baseline, read once at init scope.
const PASTRY_SAMPLE = { name: 'APIPastry-openapi.yaml', content: readSample('APIPastry-openapi.yaml') };
const PETSTORE_SAMPLE = { name: 'PetstoreAPI-collection.json', content: readSample('PetstoreAPI-collection.json') };

/** Import a sample artifact when its service is not imported yet; never deletes or re-imports. */
function ensureService(token, serviceName, sample) {
  const services = http.get(`${BASE_URL}/api/services`, chaosParams(token));
  if (services.status !== 200) {
    throw new Error(`Cannot list services (${services.status}): ${services.body}`);
  }
  const exists = (services.json() || []).some((service) => service.name === serviceName);
  if (exists) {
    console.log(`Service [${serviceName}] already imported, skipping upload.`);
    return true;
  }
  if (sample == null || sample.content == null) {
    throw new Error(`Service [${serviceName}] is missing and its sample artifact cannot be read: run from the`
        + ` testsuite directory or point SAMPLES_DIR (default ../samples) at the samples folder.`);
  }
  const uploaded = http.post(`${BASE_URL}/api/artifact/upload?mainArtifact=true`,
      { file: http.file(sample.content, sample.name) }, chaosParams(token));
  if (uploaded.status !== 201) {
    throw new Error(`Cannot import the sample artifact for [${serviceName}] (${uploaded.status}): ${uploaded.body}`);
  }
  console.log(`Service [${serviceName}] imported from the samples directory.`);
  return true;
}

/** Try to get a token from the default Microcks service account; returns '' when Keycloak is unreachable. */
function tryAuthenticate() {
  if (CHAOS_TOKEN) {
    return CHAOS_TOKEN;
  }
  const response = http.post(`${KEYCLOAK_URL}/realms/microcks/protocol/openid-connect/token`,
      { grant_type: 'client_credentials' },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Basic credentials of the default microcks-serviceaccount (same as commons.js).
          Authorization: 'Basic bWljcm9ja3Mtc2VydmljZWFjY291bnQ6YWI1NGQzMjktZTQzNS00MWFlLWE5MDAtZWM2YjNmZTE1YzU0Cg==',
        },
      });
  if (response.status !== 200) {
    console.warn(`Keycloak authentication failed (${response.status}); running without authentication (devmode?).`);
    return '';
  }
  return response.json('access_token') || '';
}

// Import the APIs the storm targets (when missing), then import or reuse the experiment. Nothing is ever deleted:
// an existing experiment is updated, stopped and restarted so its timeline re-anchors at the load beginning.
export function setup() {
  const token = tryAuthenticate();

  ensureService(token, API_STORM.service, PASTRY_SAMPLE);
  ensureService(token, API_PETSTORE.service, PETSTORE_SAMPLE);

  const auth = chaosParams(token);
  const list = http.get(`${BASE_URL}/api/chaos/experiments`, auth);
  if (list.status !== 200) {
    throw new Error(`Cannot list chaos experiments (${list.status}): ${list.body}`);
  }
  const existing = (list.json() || []).find((experiment) => experiment.name === STORM.name);

  let started;
  let experimentId;
  if (existing) {
    // Reuse the existing experiment: refresh its definition, stop it if it was running, then restart it.
    console.log(`Chaos experiment [${STORM.name}] already exists (${existing.id}), reusing it.`);
    experimentId = existing.id;
    const updated = http.put(`${BASE_URL}/api/chaos/experiments/${experimentId}`, JSON.stringify(stormPayload()),
        chaosParams(token, true));
    if (updated.status !== 200) {
      throw new Error(`Cannot update chaos experiment ${STORM.name} (${updated.status}): ${updated.body}`);
    }
    const stopped = http.post(`${BASE_URL}/api/chaos/experiments/${experimentId}/stop`, null, auth);
    if (stopped.status !== 200) {
      throw new Error(`Cannot stop chaos experiment ${STORM.name} (${stopped.status}): ${stopped.body}`);
    }
    started = http.post(`${BASE_URL}/api/chaos/experiments/${experimentId}/start`, null, auth);
  } else {
    const created = http.post(`${BASE_URL}/api/chaos/experiments`, JSON.stringify(stormPayload()),
        chaosParams(token, true));
    if (created.status !== 201) {
      throw new Error(`Cannot create chaos experiment ${STORM.name} (${created.status}): ${created.body}`);
    }
    experimentId = created.json('id');
    started = http.post(`${BASE_URL}/api/chaos/experiments/${experimentId}/start`, null, auth);
  }
  if (started.status !== 200) {
    throw new Error(`Cannot start chaos experiment ${STORM.name} (${started.status}): ${started.body}`);
  }

  const experiment = {
    id: experimentId,
    name: STORM.name,
    state: started.json('state'),
    durationMs: STORM.durationMs,
  };
  console.log(`Chaos storm started: ${experiment.name} (${experiment.id}) - 4 layers on the pastry API with cross-service 429 and 5xx overlaps on the Petstore API, then timeouts over 10 minutes`);

  return {
    baseUrl: BASE_URL,
    vus: VUS,
    duration: DURATION,
    authenticated: Boolean(token),
    token: token,
    experiments: [experiment],
  };
}

export default function () {
  // 1. Storm target: latency degradation, then 429 rate limiting, then 500 outage, then timeouts.
  const stormRes = http.get(`${BASE_URL}${API_STORM.url}`, { timeout: HTTP_TIMEOUT });
  stormRequests.add(1);
  stormDuration.add(stormRes.timings.duration);
  stormRateLimited.add(stormRes.status === 429);
  stormServerErrors.add(stormRes.status >= 500);
  stormTimeouts.add(stormRes.status === 0);
  stormSlow.add(stormRes.status === 200 && stormRes.timings.duration >= DEGRADED_MS);
  check(stormRes, {
    'GET /pastry handled by the storm (200, 429, 5xx or client timeout)': (r) => r.status === 200 || r.status === 429
        || r.status >= 500 || r.status === 0,
    '429 and 5xx responses carry the chaos body': (r) => (r.status !== 429 && r.status < 500)
        || r.body.indexOf(SYNTHETIC_BODY) !== -1,
  });

  // 2. Baseline on the same service: another operation no experiment targets.
  const itemRes = http.get(`${BASE_URL}${API_ITEM.url}`, { timeout: HTTP_TIMEOUT });
  baselineItemRequests.add(1);
  baselineItemDuration.add(itemRes.timings.duration);
  check(itemRes, {
    'GET /pastry/{name} returns 200 (baseline unaffected)': (r) => r.status === 200,
  });

  // 3. Second service: clean outside the overlap windows, 429 then 5xx while they are active.
  const petstoreRes = http.get(`${BASE_URL}${API_PETSTORE.url}`, { timeout: HTTP_TIMEOUT });
  petstoreRequests.add(1);
  petstoreDuration.add(petstoreRes.timings.duration);
  petstoreRateLimited.add(petstoreRes.status === 429);
  petstoreServerErrors.add(petstoreRes.status >= 500);
  check(petstoreRes, {
    'GET /v2/pet/findByStatus handled (200, 429, 5xx)': (r) => r.status === 200 || r.status === 429
        || r.status >= 500,
    'petstore 429 and 5xx responses carry the chaos body': (r) => (r.status !== 429 && r.status < 500)
        || r.body.indexOf(SYNTHETIC_BODY) !== -1,
  });

  sleep(WAIT_TIME);
}

// Stop the storm at the end of the load. The experiment is stopped, never deleted, and remains defined so it can
// be inspected and replayed in the Chaos UI.
export function teardown(data) {
  const auth = chaosParams(data.token);
  for (const experiment of data.experiments) {
    const stopped = http.post(`${BASE_URL}/api/chaos/experiments/${experiment.id}/stop`, null, auth);
    if (stopped.status !== 200) {
      console.error(`Failed to stop chaos experiment ${experiment.name} (${stopped.status}): ${stopped.body}`);
    }
  }
}
