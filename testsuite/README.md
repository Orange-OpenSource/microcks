# Function Testsuite for Microcks instance

This collection of scripts and test cases is designed to validate the installation methods and the functionalities of a Microcks instance.
It is designed so that same scripts and tests can/should be applied to different methods and to validate different Microcks distribution and flavors.

The tests are organized in two main categories:
* **Installation Tests**: Validate the installation methods and the Microcks instance itself. This is what we called the "health checks" below,
* **Functional Tests**: Validate the functionalities of Microcks instance by running a set of tests that cover the following aspects:
  * Microcks own APIs,
  * Mocking & Testing REST APIs,
  * Mocking & Testing GraphQL APIs,
  * Mocking & Testing gRPC APIs,
  * Mocking & Testing SOAP APIs,
  * Mocking & Testing AsyncAPI APIs.

The Testsuite is intended to be run on the current development branch of Microcks to validate the latest changes of the installation scripts 
and the features embedded into the `nightly` tagged container images. 

## Health Checks

Health checks consist in installing a Microcks instance using the provided Docker or Podman compose scripts as well as the Helm chart
provided in a Microcks release.

The installations can be driven via the `install-compose.sh` or `install-helm.sh` scripts that provides wrappers around the Docker Compose and Helm commands.

Example:
```shell
./install-compose.sh --method docker --mode default --addons async
```

The validation is actually done using the `health-check.sh` script that will check the readiness probes of the different containers started
by the different installation methods.

Example:
```shell
./check-health.sh --method docker
```


All those checks are intended to be scheduled and embedded into a [GitHub Action matrix job](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow).

## Functional Tests

The goal is to validate the functionalities of Microcks instances using different distribution and flavours.

The different configuration/combinations to consider are:
* Microcks Regular distribution with authentication enabled (`quay.io/microcks/microcks:nightly`),
* Microcks Regular distribution without authentication (aka `devmode`),
* Microcks Uber distribution using the JVM based image (`quay.io/microcks/microcks-uber:nightly`),
* Microcks Uber distribution using the native image (`quay.io/microcks/microcks-uber:nightly-native`),

Based on our experience, the following APIs and the features listed below are the most used and the most important to validate
for each different combination (unchecked boxes are not yet implemented).

### Regular distribution with authentication

#### Microcks own APIs

* [ ] Getting the configuration (`GET /api/features/config`) should return 200 when not authenticated,
* [ ] Getting the Keycloak configuration (`GET /api/keycloak/config`) should return 200 when not authenticated,
* [ ] Getting the list of services (`GET /api/services`) should return 403 when not authenticated,
* [ ] Authentication (with default _Service Account_) should return an `AccessToken` when successful,
* [ ] Getting the list of services (`GET /api/services`) should return 200 when authenticated (using `AccessToken` as a `Bearer` token),
* [ ] Getting the list of jobs (`GET /api/jobs`) should return 403 when not authenticated or authenticated as user,
* [ ] Getting the list of jobs (`GET /api/jobs`) should return 200 when authenticated as manager or admin,

#### Mocking APIs

* [ ] REST Mocks for "Pastry API 2.0 - 2.0.0" should return 200,
* [ ] GraphQL Mocks for "Movie Graph API - 1.0" should return 200,
* [ ] SOAP Mocks for "HelloService Mock - 0.9" should return 200,
* [ ] gRPC Mocks for "org.acme.petstore.v1.PetstoreService - v1" should return OK,

### Regular distribution without authentication (devmode)

#### Microcks own APIs

* [ ] Getting the configuration (`GET /api/features/config`) should return 200 when not authenticated,
* [ ] Getting the Keycloak configuration (`GET /api/keycloak/config`) should return 200 when not authenticated,
* [ ] Getting the list of services (`GET /api/services`) should return 200 when not authenticated,
* [ ] Getting the list of jobs (`GET /api/jobs`) should return 200 when not authenticated,

#### Mocking APIs

Embed the same tests as the _Regular distribution with authentication_.

### Uber distribution using the JVM based image

Embed the same tests as the _Regular distribution without authentication (devmode)_ for both the Microcks own APIs and the Mocking APIs.

### Uber distribution using the native image

Embed the same tests as the _Uber distribution using the JVM based image_ + these one in addition:

* [ ] REST Mocks using `JSON_BODY`, `FALLBACK` and `PROXY_FALLBACK` dispatcher should return 200,

The following tests must be excluded:

* [ ] SOAP Mocks for "HelloService Mock - 0.9" (as the native image is not able to execute Groovy `SCRIPT` dispatcher),

## Chaos usage test (k6)

`chaos-usage-test.js` is a standalone k6 script, launched separately from the functional testsuite, that simulates a
realistic 10-minute failure storm and shows its effect on the [k6 web dashboard](https://grafana.com/docs/k6/latest/results-output/web-dashboard/):

```shell
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=chaos-storm-report.html k6 run chaos-usage-test.js
python3 chaos-report-panels.py chaos-storm-report.html
# Live dashboard on http://localhost:5665 during the run (k6 >= 0.49);
# chaos-storm-report.html is the standalone HTML export of the same dashboard.
# Overrides: HOST, PORT, BASE_URL, KEYCLOAK_URL, CHAOS_TOKEN, SAMPLES_DIR, VUS, DURATION,
#            WAIT_TIME, HTTP_TIMEOUT, DEGRADED_MS, SYNTHETIC_BODY
HOST=localhost PORT=8080 VUS=5 K6_WEB_DASHBOARD=true k6 run chaos-usage-test.js
```

The script is self-sufficient and non-destructive:
1. Imports the two mocked APIs it needs, only when missing (`API Pastry - 2.0` from `APIPastry-openapi.yaml` and
   `Petstore API` from `PetstoreAPI-collection.json`; read from `SAMPLES_DIR`, default `../samples`),
2. Imports the Chaos experiment `k6-degradation-storm` through the `POST /api/chaos/experiments` management API
   (using the default `microcks-serviceaccount` credentials when Keycloak is enabled, or unauthenticated on
   devmode/uber). An experiment with the same name is never deleted: it is updated, stopped and restarted so its
   timeline re-anchors at the load beginning,
3. Drives load on three mocked APIs: the storm target plus two clean baselines (`GET /pastry/{name}` on the same
   service and `GET /v2/pet/findByStatus` on the Petstore API),
4. Stops the experiment after the load (never deletes it, so it stays inspectable and replayable in the Chaos UI),
5. Post-processes the report with `chaos-report-panels.py` (see below) so the evolution of the custom metrics
   becomes visible.

### Why the `chaos-report-panels.py` step

The k6 web dashboard only charts built-in metrics by default: custom metrics (the fault shares, storm latency and
request rates) appear solely as final aggregates in the dashboard's Summary tab. The exported report nevertheless
contains the full time series (10-second snapshots), and its dashboard configuration is plain JSON embedded in the
HTML - so `chaos-report-panels.py` injects a Chaos tab into that configuration, using the same panel schema as the
built-in tabs. Opening the report then shows the evolution over time: fault shares per service, storm latency
against the clean control, and request rates.

Note: after the run completes, the k6 process keeps the dashboard HTTP server (port 5665) alive and does not exit on
its own - kill it once you are done watching, or set `K6_WEB_DASHBOARD_PORT=-1` in CI.

The storm sequence, on a single experiment with one track (layer) per intention. The first four layers target
`GET /pastry` (API Pastry - 2.0); the last two target `GET /v2/pet/findByStatus` (Petstore API) with windows that
OVERLAP the pastry ones, so both services degrade at the same time during parts of the run:

| Layer | Service | Timeline | Intention | Keyframes |
| --- | --- | --- | --- | --- |
| `latency-degradation` | API Pastry - 2.0 | 0 – 2.5min | Latency ramp-up | 12-step ramp 50 -> 80 -> 120 -> ... -> 1500 ms |
| `rate-limiting-429` | API Pastry - 2.0 | 2.5 – 5min | Rate limiting | Probability ramp 15% -> 100% of 429s |
| `outage-5xx` | API Pastry - 2.0 | 5 – 7.5min | Server errors | Probability ramp 30% -> 100%, statuses rotating 500 -> 502 -> 503 |
| `timeout-blackhole` | API Pastry - 2.0 | 7.5 – 10min | Timeout | Constant 30s latency, above the 10s client timeout |
| `petstore-rate-limiting-429` | Petstore API | 3 – 5min | Rate limiting (overlap) | Probability ramp 20% -> 100% of 429s, overlapping the pastry 429 layer |
| `petstore-outage-5xx` | Petstore API | 5.5 – 8min | Server errors (overlap) | Probability ramp 25% -> 100%, 503 then 500, overlapping the pastry 5xx layer and the timeout phase |

`GET /pastry/{name}` stays a clean control for the whole run. During the 3–5min window both services are
rate-limited at the same time, and during 5.5–7.5min both are erroring with 5xx while the pastry API enters its
timeout phase at 7.5min.

On the dashboard, the usage of the experiment is visible in the chaos-specific metrics plotted over time:
`storm_rate_limited` / `storm_server_errors` / `storm_timeouts` / `storm_slow` and `storm_duration` for the pastry
API, `petstore_rate_limited` / `petstore_server_errors` and `petstore_duration` for the Petstore overlap windows,
and `baseline_item_duration` as the clean control.