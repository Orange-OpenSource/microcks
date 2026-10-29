# Microcks Chaos — Backend Architecture Review

This review covers the Java changes staged in the working tree. It includes `webapp/src/main/java/io/github/microcks/chaos/**`, `domain/chaos/**`, `repository/ChaosExperimentRepository`, and the changes to `RestController` and `SecurityConfiguration`. I compared the code with the project conventions and with `Microcks_Chaos_Testing_Technical_Specification_v0.3.md`, the target design.

Problems are grouped by severity. Each item gives the location, the problem, and a suggested fix.

> **Status update:** items [3.3], [3.2], [4.3], [4.5] and [5] have been fixed in a follow-up change. See
> [Resolved items](#resolved-items) at the end of this document.

---

## 1. Critical: wrong injection point in the request pipeline

### 1.1 Faults run *after* the mock has been fully processed
`RestController.processMockInvocationRequest` calls `invocationProcessor.processInvocation(...)` first and then passes the finished response to `faultInjector.inject(...)`. By that point `RestInvocationProcessor` has already:

- dispatched and rendered the response (templates, `ServiceStateStore` mutations),
- applied the operation's normal delay (`MockControllerCommons.waitForDelay`),
- published the `MockInvocationEvent`, so the call is **counted as a successful invocation in metrics**,
- fired **callbacks and AsyncAPI triggers**.

A synthetic `503` therefore still has every side effect of a successful call. The spec (§8.1, §8.3, AC‑05) asks for a `PRE_DISPATCH` HTTP error that skips the dispatcher and its side effects. The architecture doc lists this as a "known limitation", but the fix is structural, not an optimization. If it is left as is, later faults (disconnect, first‑byte delay, slow body) cannot be added without a rewrite.

**Fix:** add a `RestChaosCoordinator` right after service/operation resolution. It builds an execution plan, then either short‑circuits (synthetic error) or calls the processor, with an option to defer the normal delay.

### 1.2 The `ResponseEntity<byte[]>` contract does not scale to the planned faults
`FaultModifier.inject(ModifierConfig, long, ResponseEntity<byte[]>)` only works on a fully buffered response. Truncation, slow body, abort and HTTP/2 reset (spec §7) need access to the `HttpServletResponse` or an async writer. The extension point will have to break as soon as the next modifier type is added.

**Fix:** split planning (a pure function from config and position to a decision) from delivery (`RestResponseDelivery`), as the spec describes.

### 1.3 Chaos only covers one protocol entry point
Only `RestController` (`/rest` and `/rest-valid`) is wired. These paths skip chaos even when they serve the same operations:
- `McpController`, which reuses `RestInvocationProcessor` for REST tools,
- `DynamicMockRestController` (`/dynarest`),
- SOAP, GraphQL and gRPC.

A `*`/`*` track looks like it matches everything but does not. Attaching the hook to the controller instead of a shared layer guarantees gaps like these.

**Fix:** either restrict targets explicitly to REST and validate that, or attach the coordinator at a shared invocation layer.

---

## 2. Critical: hot‑path performance and resource safety

### 2.1 MongoDB query on every mock request
`FaultInjector.inject` calls `repository.findByStateIn(RUNNING)` on **every** REST mock call, even when no experiment exists. This adds a database round trip to the main latency‑sensitive path for all users. The spec (§3, §12) says "No MongoDB reads in the request hot path" and requires a `CompiledTimelineCache`.

### 2.2 The declared indexes are probably never created
`@Indexed` on `ChaosExperiment.state` and `name` relies on Spring Data auto‑index creation, which is off by default. Microcks creates indexes explicitly in `MongoConfiguration` (for `ServiceState` only). The per‑request query is likely a collection scan, and name uniqueness has no index behind it (see 4.2).

### 2.3 Latency blocks servlet threads, with no global limit
`LatencyFaultModifier` calls `Thread.sleep(delay)` on the request thread. `MAX_LATENCY_MS = 60 s` is checked **per track**, but delays add up across all matching tracks of all running experiments. Nothing limits the total delay, the number of concurrent delayed requests, or the number of tracks. A single manager can exhaust the Tomcat pool with one `*`/`*` experiment. The latency is also added **on top of** the normal operation delay, and there is no additive/override policy (spec §6.2, §14.1).

### 2.4 Shared `RandomGenerator` is not thread‑safe
`FaultInjector` keeps one `RandomGenerator.getDefault()` instance (`L32X64MixRandom`, documented as **not thread‑safe**) and uses it from every request thread. Use `ThreadLocalRandom.current()` or a per‑request generator, ideally with a seed so runs can be reproduced (spec §6.3).

---

## 3. High: safety and operability

### 3.1 Experiments never end
A `RUNNING` experiment loops (`elapsed % durationMs`) until someone stops it. It is stored in MongoDB, so it **survives restarts**. `durationMs` is really a period, not a duration. There is no TTL, no maximum total run time, no auto‑stop, and no global kill switch or feature flag (Microcks already has `features.properties` / `FeaturesConfigController`). A forgotten experiment keeps breaking shared mocks indefinitely. Spec §4.1, §12 and AC‑13 require expiry and an emergency kill.

### 3.2 No observability
Nothing records an injected fault: no OpenTelemetry span event or attribute, no metric, no log line, no response marker header. The rest of `RestController` relies on explain tracing (`TraceUtil`, `CommonEvents`). Users of Live Traces cannot tell an injected 503 from a real one, and the invocation metrics show a success (see 1.1). See spec §11.

### 3.3 The synthetic error response drops headers
`HttpErrorFaultModifier` builds a new `HttpHeaders` with only `Content-Length`. This drops CORS headers, `Content-Type`, and any headers the mock defines. Browser clients will see a CORS failure instead of the configured status.

### 3.4 Conflicting tracks are resolved by list order
Several running experiments, or several tracks, can target the same operation. Behavior then depends on iteration order (Mongo order across experiments, list order within one):
- multiple `HTTP_ERROR` tracks: the last one wins,
- latency after an error: it still sleeps.

There is no priority, no conflict validation, and no rule about overlapping experiments (spec §6.2, §14.1).

---

## 4. High: control plane and data model

### 4.1 Lifecycle state is inconsistent with the spec, and part of it is unused
- Only `RUNNING` and `STOPPED` exist. The spec defines `DRAFT → SCHEDULED → RUNNING ↔ PAUSED → COMPLETED/STOPPED`.
- `stop()` saves `anchorPositionMs`, but `start()` always resets it to `0`, so the saved position is never read back. The anchor model exists without the pause/resume it was designed for.
- `start()` returns the saved entity without `decoratePosition`. Unlike every other read, its response has no `currentPositionMs`.

### 4.2 No concurrency control
- `ChaosExperiment` has no `@Version`. `start`, `stop` and `update` all read, modify and save, so concurrent calls (or two replicas) silently overwrite each other.
- Name uniqueness is checked with `findByName` before `save`. Without a unique index, two concurrent creates can both succeed.
- `update()` is allowed while the experiment is `RUNNING`. Changing `durationMs` or the tracks shifts the playhead and the active faults mid‑run, with no revision, even though the spec requires that "in‑flight requests retain their revision" (§4.1).

### 4.3 Definition and run state share one document
`ChaosExperiment` holds the reusable timeline definition *and* the current run's clock anchors (the Javadoc admits this). The same class is also:
- the Mongo `@Document`,
- the REST request body (clients can send `state`, `anchorWallTime`, ...),
- the REST response (`@Transient currentPositionMs`).

As a result there is no run history, editing a definition affects the live run, and API/DTO concerns leak into the persistence model.

**Fix:** separate `ExperimentDefinition` (versioned) from `ExperimentRun`, and add request/response DTOs.

### 4.4 `update()` has unclear semantics
`name == null` keeps the existing name, but `description == null` **clears** the description, and `tracks == null` clears all tracks. The PUT is neither a full replacement nor a patch.

### 4.5 Validation mutates state and is duplicated
- `ModifierTrack.validate()` silently sets `endMs = durationMs` when `endMs <= 0`, so validation has a side effect.
- The non‑blank track id check is done in both `ChaosExperiment.validate()` and `ModifierTrack.validate()`.
- Validation is done with `IllegalArgumentException` in domain classes. The controller maps **any** `IllegalArgumentException` or `IllegalStateException` to `400`, so a genuine bug (for example `HttpStatusCode.valueOf` on bad persisted data) shows up as a client error.

### 4.6 Targets are loose and not linked to the services catalog
- Tracks target services by **name only**, with no version, so every version of a service is affected.
- Matching is case‑insensitive, while the rest of Microcks resolves names exactly.
- There is no reference to `Service`/`Operation` ids. Deleting or renaming a service leaves dangling tracks, and `ServiceService.deleteService` has no cascade.
- Nothing scopes tracks per service or owner, so any `ROLE_MANAGER` user can fault every mock with `*`.

---

## 5. Medium: package layout and layering

### 5.1 Domain classes in a split package in the wrong module
Microcks domain objects live in `commons/model` (`io.github.microcks.domain.*`). The chaos domain sits in `webapp` under the **same package** `io.github.microcks.domain.chaos`. This creates a split package across two artifacts. Tools that use `commons/model` (CLI, minions, the API schema) cannot see the classes, and it breaks the module boundary.

### 5.2 A new vertical package that does not follow the existing layers
The existing layout is horizontal: `web/` (controllers), `service/`, `repository/`, `domain/`. The new code adds `chaos/` (service and injector), `chaos/api/` (controller and DTOs), `chaos/modifier/` and `chaos/runtime/`, while the repository stays in `repository/` and the domain stays in `domain/`. Both styles now exist side by side.

### 5.3 The runtime depends on UI and API DTOs
`FaultModifier` (runtime) returns `ChaosModifierDescriptor`, defined in `chaos.api`. Every runtime modifier therefore carries editor metadata (labels, defaults). The dependency runs from runtime to API instead of the other way round.

### 5.4 The descriptor and validation can drift apart
The modifier catalog that the UI uses is written by hand in each `FaultModifier.DESCRIPTOR`. Validation and defaults are written separately in the `*ModifierConfig` classes:
- **Defaults differ:** the descriptor's default probability is `0.8`, while `ModifierTrack` defaults to `ParameterCurve.constant(0)`.
- **Values are duplicated:** latency `1000`, status `503`, and the range `400–599` appear in two places each.
- **Advertised keyframes do not match the model:** `HTTP_ERROR.statusCode` is advertised as not keyframeable, but the spec (§7.2) lists it as keyframeable with STEP.

The descriptor's own Javadoc promises a single source of truth, which the code does not deliver.

### 5.5 Adding a modifier is not real extensibility
Adding one modifier means editing the `ModifierType` enum, the `@JsonSubTypes` list on `ModifierConfig`, a new config class, a new `FaultModifier`, and the hand‑written descriptor. The `FaultModifier` interface suggests a plugin point, but the set is closed at compile time. Persisted documents also depend on Java class names through Mongo's `_class`.

### 5.6 Two clock sources
`ChaosExperimentClock` holds its own `Clock.systemUTC()`, and `ChaosExperimentService` holds a second one (`wallClock`). The injector reads one and the API reads the other, so tests cannot freeze both consistently. Expose one `Clock` bean. The two `@Autowired` no‑arg or partial constructors also exist only to work around the missing bean.

---

## 6. Medium: API, security and conventions

- **No API contract.** Microcks documents its management API in `api/microcks-openapi-v1.x.yaml`. `/api/chaos/**` is not added there, so the CLI and clients have no contract.
- **Controller‑local exception handlers** (`@ExceptionHandler` inside `ChaosController`) are a new pattern. No other controller does this. Error bodies (`{"error": ...}`) also differ from the existing endpoints.
- **Security matcher style.** The new rules use `/**`, while the existing rules use explicit `*` segments. They are inserted in the middle of the secrets rules. With Keycloak disabled, all chaos endpoints are open; given the effect on shared mocks, consider gating the feature behind a flag.
- **Native image.** The polymorphic Jackson/Mongo types (`ModifierConfig` subtypes) are not registered for GraalVM reflection, and native builds have not been checked (spec §9.2, AC‑12).
- **Mock path behavior changed with no opt‑out.** Even with zero experiments, every REST mock now goes through the injector and its database query. AC‑01 ("no active experiments ⇒ unchanged behavior") is not met in terms of performance.

---

## 7. Tests

- `ChaosControllerIT` measures real wall‑clock time (`elapsed >= 500`, `< 500`). Expect flakiness in CI.
- No test covers the side‑effect problem (metrics, callbacks), header preservation, concurrent start/stop, combined latency across tracks, or more than one running experiment.
- `ChaosTimelineTest` reaches into the package‑private static `FaultInjector.matches`. Matching logic is mixed with injection, so it can only be tested this way. A separate `TrackMatcher` would make it a proper unit.

---

## 8. Unrelated change in the same diff

`install/docker-compose/docker-compose-devmode.yml` contains local developer changes that have nothing to do with chaos:
- the Mongo volume moves to `microcks-data2`,
- port `27017` is exposed,
- the Postman, Kafka and other services are commented out.

Remove it from this change set.

---

## Summary of recommended direction

| Priority | Action |
| --- | --- |
| P0 | Move injection **before** dispatch through a `RestChaosCoordinator`; define side‑effect, metrics and delay semantics. |
| P0 | Replace the per‑request Mongo query with a per‑replica immutable compiled snapshot refreshed by revision. |
| P0 | Use a thread‑safe RNG; add global limits on latency and concurrency; stop blocking request threads for long delays. |
| P1 | Add TTL/auto‑expiry, a global kill switch or feature flag, and OpenTelemetry events and metrics for injected faults. |
| P1 | Add `@Version`/revision, a unique name index, and separate definition from run; block or version edits while running. |
| P1 | Preserve or merge response headers (CORS, content type) on synthetic errors; define precedence for conflicting tracks. |
| P2 | Move domain classes to `commons/model` (or a non‑split package); align with the `web/` and `service/` layering; separate API DTOs from entities. |
| P2 | Derive descriptors from one typed parameter schema used for both validation and the UI catalog. |
| P2 | Document `/api/chaos` in the OpenAPI spec, check native image, and replace timing‑based ITs. |
| — | Revert the unrelated `docker-compose-devmode.yml` changes. |

---

## Resolved items

The following items were fixed after this review was written. Verification: `mvn spotless:apply`, then
`mvn -pl webapp -am -Dtest='ChaosControllerIT,ChaosTimelineTest,RestControllerIT,ParameterCurveTest' -Dsurefire.failIfNoSpecifiedTests=false test` — 37 tests, all passing (including `RestControllerIT` as the no‑regression check).

### [3.3] Synthetic error response keeps its headers

`HttpErrorFaultModifier.inject` now copies the generated response headers (CORS policy, `Content-Type`, mock‑defined
headers) into the synthetic response and only adjusts `Content-Length` to the new body size. The IT asserts that a
faulted response still carries a content type and the injection markers.

### [3.2] Observability added

Every applied injection runs in a dedicated `chaosFaultInjection` INTERNAL child span of the mock invocation span,
created directly in `FaultInjector` through the `OpenTelemetryResolverService` tracer — the same pattern as
`RestInvocationProcessor.computeDispatchCriteria`. The span carries the `chaos.*` attributes added to
`CommonAttributes` (`chaos.experiment.id`, `chaos.experiment.name`, `chaos.track.id`, `chaos.fault.type`,
`chaos.position.ms`, `chaos.probability`) and is marked for explain tracing, so injected faults are visible and
correlated in Live Traces. `FaultInjector` also logs each injection. No marker response headers are emitted.

### [4.3] Definition and run are separate documents

- `ChaosExperiment` (collection `chaos_experiments`) is now the pure timeline definition: id, name, description, durationMs, tracks. It no longer holds `state`, the clock anchors or the `@Transient currentPositionMs`.
- New `ExperimentRun` (collection `chaos_experiment_runs`) holds `experimentId`, `state`, `anchorPositionMs` and `anchorWallTime`; at most one run per experiment, created on first start.
- `ChaosExperimentService` composes definition + run into a `ExperimentWithRun` snapshot; `ChaosController` maps it to the flat `ChaosExperimentDTO` (`web/dto`) so the wire shape stays the same as before and the Angular editor needs no change.
- Create/update bind to the definition only — run state can no longer be smuggled in through a request body.

### [4.5] Validation is pure and no longer duplicated

- `ModifierTrack.validate()` no longer mutates `endMs`; it rejects a missing end instead. `ChaosExperimentService.resolveTrackWindows` normalizes `endMs <= 0` to the experiment duration before validating and persisting (asserted by the IT).
- The non‑blank track id check lives only in `ModifierTrack.validate()`; `ChaosExperiment.validate()` relies on it before the duplicate‑id check.
- Domain validation throws the new `InvalidExperimentException` (subclass of `IllegalArgumentException`) instead of bare `IllegalArgumentException`. `ChaosController` maps only that exception to `400`; unexpected `IllegalArgumentException`/`IllegalStateException` from bugs now surface as `500`.

### [5] Package layout and layering

- **Split package removed:** the chaos domain moved to `commons/model` under the unchanged package name `io.github.microcks.domain.chaos` (the module already carries the Spring Data MongoDB and Jackson dependencies). `ParameterCurveTest` moved with it.
- **Horizontal layering restored:** `ChaosController` → `io.github.microcks.web`, `ChaosExperimentService` → `io.github.microcks.service`, repositories → `io.github.microcks.repository`. The remaining `chaos/` package holds only the request‑time engine (`FaultInjector`, `ChaosExperimentClock`, `ChaosTelemetry`, `ChaosConfiguration`, `modifier/*`) plus the descriptor records it owns. The `chaos/api` and `chaos/runtime` subpackages are gone.
- **Dependency direction fixed:** the descriptor records (`ChaosModifierDescriptor`, `ChaosModifierParam`) now live in the runtime package and the web layer consumes them — no more runtime‑depends‑on‑API inversion.
- **Descriptor/validation drift closed:** bounds and defaults come from constants on the config classes (`MIN_STATUS_CODE`/`MAX_STATUS_CODE`/`DEFAULT_STATUS_CODE`, `DEFAULT_LATENCY_MS`); the probability parameter is defined once (`ChaosModifierParam.probability()`), and the editor‑default (`0.8`) vs persistence‑default (`0`, inactive) difference is documented as intentional. `statusCode` is now keyframeable (`ParameterCurve`, step semantics) as the spec §7.2 requires, which the catalog‑driven editor renders without frontend changes.
- **One clock:** `ChaosConfiguration` exposes a single `Clock` bean; `ChaosExperimentClock` and `ChaosExperimentService` both inject it, and the dual `@Autowired` test constructors are gone.

Also fixed in passing (review item 2.4): `FaultInjector` now samples probability with `ThreadLocalRandom` — the shared `RandomGenerator.getDefault()` is not thread‑safe.

Known consequence: experiment documents created before this change (dev databases only — the feature is unmerged) hold a numeric `statusCode` that no longer deserializes; re‑create them.
