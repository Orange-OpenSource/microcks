/*
 * Copyright The Microcks Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ServicesService } from '../../services/services.service';
import { ChaosService } from '../../services/chaos.service';
import { Operation, Service } from '../../models/service.model';
import {
  ChaosCurve,
  ChaosExperiment,
  ChaosKeyframe,
  ChaosModifierConfig,
  ChaosModifierDescriptor,
  ChaosModifierParam,
  ChaosTrack,
  ExperimentState,
} from '../../models/chaos.model';
import {
  ChaosParamKey,
  ChaosParamSpec,
  ChaosSelection,
  SNAP_MS,
  clamp,
  curveValueAt,
  dedupeKeyframes,
  getParamCurve,
  isNumericParam,
  isParamAnimated,
  minKeyframes,
  newTrack,
  snapToSecond,
  sortedKeyframes,
  trackProbabilityAt,
  trackWindow,
  uniqueTrackId,
  validateExperiment,
  withParamCurve,
} from './chaos-editor.utils';

/**
 * Client-side store of the chaos editor: it owns the working copy of the edited experiment, the playhead and
 * all timeline mutations. Components render from the signals exposed here and delegate every edit to this service.
 */
@Injectable()
export class ChaosEditorService implements OnDestroy {
  private chaosService = inject(ChaosService);
  private servicesService = inject(ServicesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /** Known experiments, refreshed after each save or creation. */
  readonly experiments = signal<ChaosExperiment[]>([]);
  /** Working copy of the edited experiment. Mutations only touch this copy. */
  readonly experiment = signal<ChaosExperiment | null>(null);
  /** True when the working copy differs from the persisted experiment. */
  readonly dirty = signal(false);
  /** Load/save indicators. */
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly selectedTrackId = signal<string | null>(null);
  readonly expandedTrackIds = signal<Set<string>>(new Set());
  readonly selection = signal<ChaosSelection | null>(null);

  /** Playhead position. While running it follows the server position unless the user scrubs. */
  readonly playheadMs = signal(0);
  readonly followServer = signal(true);
  private readonly serverPositionMs = signal<number | null>(null);

  /** Catalog of services available as modifier targets, with their operations. */
  readonly services = signal<Service[]>([]);

  /**
 * Modifier catalog and parameter metadata, fetched from the backend (GET /api/chaos/modifiers).
 * The backend is the single source of truth: when the request fails, no modifier can be added or edited.
 */
  readonly modifierCatalog = signal<ChaosModifierDescriptor[]>([]);

  /** Keyframeable parameters of a modifier type, as described by the backend catalog. */
  paramsOfType(type: string): ChaosParamSpec[] {
    return this.descriptorParams(type)
      .filter((param) => param.keyframeable !== false)
      .map((param) => this.toSpec(param));
  }

  /** Static (non keyframeable) parameters of a modifier type, as described by the backend catalog. */
  staticParamsOfType(type: string): ChaosModifierParam[] {
    return this.descriptorParams(type).filter((param) => param.keyframeable === false);
  }

  private descriptorParams(type: string): ChaosModifierParam[] {
    const entry = this.modifierCatalog().find((item) => item.type === type);
    return entry?.params ?? [];
  }

  private toSpec(param: ChaosModifierParam): ChaosParamSpec {
    return {
      key: param.name,
      label: param.label || param.name,
      min: param.min ?? 0,
      max: param.max ?? 0,
      defaultValue: param.defaultValue ?? null,
      format:
        param.name === 'probability'
          ? (v: number) => Math.round(v * 100) + '%'
          : (v: number) => String(Math.round(v)),
      inputValue:
        param.name === 'probability'
          ? (v: number) => String(Math.round(v * 100))
          : (v: number) => String(Math.round(v)),
      parseInput:
        param.name === 'probability'
          ? (text: string) => parseFloat(text) / 100
          : (text: string) => parseFloat(text),
    };
  }

  /** Human label of a modifier type, from the fetched catalog. */
  typeLabel(type: string): string {
    const entry = this.modifierCatalog().find((item) => item.type === type);
    return entry?.label ?? String(type);
  }

  readonly durationMs = computed(() => this.experiment()?.durationMs ?? 60000);
  readonly state = computed(() => this.experiment()?.state ?? ExperimentState.STOPPED);
  readonly running = computed(() => this.state() === ExperimentState.RUNNING);
  readonly tracks = computed(() => this.experiment()?.tracks ?? []);
  readonly selectedTrack = computed<ChaosTrack | null>(() => {
    const id = this.selectedTrackId();
    return this.tracks().find((track) => track.id === id) ?? null;
  });

  private pollSubscription?: Subscription;
  /** Id of the experiment currently being loaded, so a URL param echoing it does not trigger a reload. */
  private pendingSelectionId: string | null = null;

  constructor() {
    this.loadExperiments();
    this.loadServices();
    this.loadCatalog();
    // The edited experiment id lives in the URL (/chaos/:experimentId): load it on deep links
    // and follow back/forward navigation.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('experimentId');
      if (id && id !== this.experiment()?.id && id !== this.pendingSelectionId) {
        this.selectExperiment(id);
      }
    });
    effect(() => this.syncPolling());
    effect(() => {
      const position = this.serverPositionMs();
      if (position !== null && this.followServer()) {
        this.playheadMs.set(clamp(snapToSecond(position), 0, this.durationMs()));
      }
    });
  }

  ngOnDestroy(): void {
    this.pollSubscription?.unsubscribe();
  }

  // ---------------------------------------------------------------- Experiments ----

  loadExperiments(): void {
    this.chaosService.listExperiments().subscribe({
      next: (experiments) => {
        this.experiments.set(experiments);
        // With a deep link (/chaos/:experimentId) the route param drives the initial selection.
        if (!this.experiment() && !this.route.snapshot.paramMap.get('experimentId') && experiments.length > 0) {
          this.selectExperiment(experiments[0].id as string);
        }
      },
      error: () => {
        /* Error notification to be added later. */
      },
    });
  }

  /** Load an experiment as the new working copy and reflect its id in the URL. */
  selectExperiment(id: string): boolean {
    this.pendingSelectionId = id;
    this.syncUrl(id);
    this.loading.set(true);
    this.chaosService.getExperiment(id).subscribe({
      next: (experiment) => {
        this.pendingSelectionId = null;
        this.setWorkingCopy(experiment);
      },
      error: () => {
        this.pendingSelectionId = null;
        this.loading.set(false);
      },
    });
    return true;
  }

  createExperiment(name: string, durationMs: number): void {
    const draft: ChaosExperiment = {
      name: name.trim(),
      durationMs: Math.max(1, Math.round(durationMs)),
      state: ExperimentState.STOPPED,
      anchorPositionMs: 0,
      tracks: [],
    };
    this.chaosService.createExperiment(draft).subscribe({
      next: (created) => {
        this.experiments.update((list) => [...list, created]);
        this.setWorkingCopy(created);
        this.syncUrl(created.id as string);
      },
      error: () => {
        /* Error notification to be added later. */
      },
    });
  }

  save(): void {
    this.persistWorkingCopy(() => {});
  }

  /** Validate then PUT the working copy, refreshing the store with the saved experiment. */
  private persistWorkingCopy(onSaved: (saved: ChaosExperiment) => void): void {
    const experiment = this.experiment();
    if (!experiment || !experiment.id) {
      return;
    }
    const problems = validateExperiment(experiment);
    if (problems.length > 0) {
      // Invalid experiments are not persisted; error notification to be added later.
      return;
    }
    this.saving.set(true);
    this.chaosService.updateExperiment(experiment).subscribe({
      next: (saved) => {
        this.setWorkingCopy(saved, false);
        this.experiments.update((list) => list.map((item) => (item.id === saved.id ? saved : item)));
        onSaved(saved);
      },
      error: () => {
        this.saving.set(false);
      },
      complete: () => this.saving.set(false),
    });
  }

  start(): void {
    this.runLifecycle('startExperiment');
  }

  stop(): void {
    this.runLifecycle('stopExperiment');
  }

  /** Delete the current experiment on the server and clear the editor. */
  deleteExperiment(): void {
    const experiment = this.experiment();
    if (!experiment?.id) {
      return;
    }
    this.saving.set(true);
    this.chaosService.deleteExperiment(experiment.id).subscribe({
      next: () => {
        this.experiments.update((list) => list.filter((item) => item.id !== experiment.id));
        this.experiment.set(null);
        this.selectedTrackId.set(null);
        this.selection.set(null);
        this.expandedTrackIds.set(new Set());
        this.dirty.set(false);
        this.saving.set(false);
        const remaining = this.experiments();
        if (remaining.length > 0) {
          this.selectExperiment(remaining[0].id as string);
        } else {
          this.syncUrl(null);
        }
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  private runLifecycle(action: 'startExperiment' | 'stopExperiment'): void {
    const experiment = this.experiment();
    if (!experiment?.id) {
      return;
    }
    const proceed = () => {
      this.chaosService[action](experiment.id as string).subscribe({
        next: (updated) => {
          this.setWorkingCopy(updated, false);
          // Re-align the playhead with the clock anchors returned by the action.
          this.followServer.set(true);
          this.playheadMs.set(updated.currentPositionMs ?? 0);
          this.experiments.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
        },
        error: () => {
          /* Error notification to be added later. */
        },
      });
    };
    // A running experiment should reflect the timeline being edited: save first when dirty.
    if (this.dirty() && action === 'startExperiment') {
      this.persistWorkingCopy(() => proceed());
      return;
    }
    proceed();
  }

  /**
   * Replace the working copy with a server response. When `fresh` is true (experiment switch or creation),
   * the selection is reset and the playhead jumps to the server position; otherwise the current view state
   * (selection, expansion, playhead) is preserved.
   */
  private setWorkingCopy(experiment: ChaosExperiment, fresh: boolean = true): void {
    const copy = JSON.parse(JSON.stringify(experiment)) as ChaosExperiment;
    this.experiment.set(copy);
    this.dirty.set(false);
    this.loading.set(false);
    if (fresh) {
      this.selection.set(null);
      const firstTrack = copy.tracks[0];
      this.selectedTrackId.set(firstTrack ? firstTrack.id : null);
      this.expandedTrackIds.set(new Set());
      this.followServer.set(true);
      this.playheadMs.set(copy.currentPositionMs ?? 0);
    }
  }

  /** Rename the experiment itself. */
  renameExperiment(name: string): void {
    const trimmed = name.trim();
    this.experiment.update((current) => (current ? { ...current, name: trimmed } : current));
    this.dirty.set(true);
  }

  /** Reflect the edited experiment id in the URL (/chaos/:experimentId); no-op when already in sync. */
  private syncUrl(id: string | null): void {
    const currentId = this.route.snapshot.paramMap.get('experimentId') ?? null;
    if (currentId === id) {
      return;
    }
    this.router.navigate(id ? ['/chaos', id] : ['/chaos'], { replaceUrl: true });
  }

  // ---------------------------------------------------------------- Playhead ----

  /** Move the playhead. User interactions stop the automatic follow of a running experiment. */
  setPlayhead(timeMs: number, userInitiated: boolean = true): void {
    const clamped = clamp(snapToSecond(timeMs), 0, this.durationMs());
    if (userInitiated) {
      this.followServer.set(false);
    }
    this.playheadMs.set(clamped);
  }

  /** Resume following the server position of a running experiment. */
  resumeFollowing(): void {
    const position = this.serverPositionMs();
    this.followServer.set(true);
    if (position !== null) {
      this.playheadMs.set(position);
    }
  }

  private syncPolling(): void {
    if (this.running() && this.experiment()?.id) {
      if (!this.pollSubscription) {
        this.pollSubscription = interval(1000).subscribe(() => this.pollPosition());
      }
    } else {
      this.pollSubscription?.unsubscribe();
      this.pollSubscription = undefined;
    }
  }

  private pollPosition(): void {
    const id = this.experiment()?.id;
    if (!id) {
      return;
    }
    this.chaosService.getExperiment(id).subscribe({
      next: (experiment) => {
        this.serverPositionMs.set(experiment.currentPositionMs ?? 0);
        const currentState = this.state();
        if (experiment.state !== currentState) {
          // The experiment ended or changed state server-side: refresh the working copy runtime fields.
          this.experiment.update((current) =>
            current ? { ...current, state: experiment.state, currentPositionMs: experiment.currentPositionMs } : current,
          );
          this.experiments.update((list) =>
            list.map((item) => (item.id === experiment.id ? { ...item, state: experiment.state } : item)),
          );
        } else {
          this.experiment.update((current) =>
            current ? { ...current, currentPositionMs: experiment.currentPositionMs } : current,
          );
        }
      },
      error: () => {
        /* Transient polling errors are ignored; the next tick retries. */
      },
    });
  }

  // ---------------------------------------------------------------- Tracks ----

  selectTrack(trackId: string): void {
    this.selectedTrackId.set(trackId);
    this.selection.set({ trackId });
  }

  toggleExpanded(trackId: string): void {
    this.expandedTrackIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }

  isExpanded(trackId: string): boolean {
    return this.expandedTrackIds().has(trackId);
  }

  addTrackOfType(type: string): void {
    this.addModifier(type, '', '');
  }

  /** Id of the graph node whose dropdown is currently open, so opening one closes the others. */
  readonly openMenuNodeId = signal<string | null>(null);

  /**
   * Move a track to a new position in the stacking order. The insertion index refers to the current list
   * (including the dragged track); the backend applies modifiers in track order, so reordering changes
   * which fault wins when several are active at the same time.
   */
  reorderTrack(trackId: string, insertionIndex: number): void {
    const experiment = this.experiment();
    if (!experiment) {
      return;
    }
    const currentIndex = experiment.tracks.findIndex((track) => track.id === trackId);
    if (currentIndex < 0) {
      return;
    }
    const insertion = Math.max(0, Math.min(experiment.tracks.length, insertionIndex));
    if (insertion === currentIndex || insertion === currentIndex + 1) {
      return;
    }
    const tracks = [...experiment.tracks];
    const [moved] = tracks.splice(currentIndex, 1);
    tracks.splice(insertion > currentIndex ? insertion - 1 : insertion, 0, moved);
    this.experiment.update((current) => (current ? { ...current, tracks } : current));
    this.dirty.set(true);
  }

  /** Create a modifier targeting the given service/operation pair, supporting the '*' wildcard. */
  addModifierForTarget(serviceName: string, operationName: string): void {
    this.addModifier(this.modifierCatalog()[0]?.type ?? '', serviceName, operationName);
  }

  addModifier(type: string, serviceName: string, operationName: string): void {
    const experiment = this.experiment();
    if (!experiment || !type) {
      return;
    }
    // Default the track name to its target selector plus the modifier type, eg
    // "Payment/POST /payments - HTTP error"; the type label comes from the fetched catalog.
    const typeLabel = this.typeLabel(type);
    const selector = serviceName ? serviceName + '/' + (operationName || '*') : '';
    const id = uniqueTrackId(experiment, selector ? selector + ' - ' + typeLabel : typeLabel);
    // Initial values come from the backend catalog defaults.
    const probability =
      this.paramsOfType(type).find((spec) => spec.key === 'probability')?.defaultValue ?? 0;
    const modifier: ChaosModifierConfig = { type };
    for (const param of this.staticParamsOfType(type)) {
      modifier[param.name] = param.defaultValue ?? (isNumericParam(param) ? (param.min ?? 0) : '');
    }
    // Keyframeable parameters other than probability are curves inside the modifier config, initialized
    // to a single constant keyframe holding the catalog default.
    for (const spec of this.paramsOfType(type)) {
      if (spec.key !== 'probability') {
        modifier[spec.key] = { keyframes: [{ timeMs: 0, value: spec.defaultValue ?? 0 }] };
      }
    }
    const track = { ...newTrack(id, experiment.durationMs, modifier, probability), serviceName, operationName };
    this.experiment.update((current) =>
      current ? { ...current, tracks: [...current.tracks, track] } : current,
    );
    this.dirty.set(true);
    this.selectedTrackId.set(id);
    this.selection.set({ trackId: id });
    this.expandedTrackIds.update((ids) => new Set(ids).add(id));
  }

  removeTrack(trackId: string): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    this.experiment.update((current) =>
      current ? { ...current, tracks: current.tracks.filter((item) => item.id !== trackId) } : current,
    );
    this.dirty.set(true);
    if (this.selectedTrackId() === trackId) {
      const remaining = this.tracks();
      this.selectedTrackId.set(remaining.length > 0 ? remaining[0].id : null);
      this.selection.set(null);
    }
    this.expandedTrackIds.update((ids) => {
      const next = new Set(ids);
      next.delete(trackId);
      return next;
    });
  }

  renameTrack(trackId: string, newName: string): void {
    const name = newName.trim();
    if (!name || name === trackId) {
      return;
    }
    if (this.tracks().some((track) => track.id === name)) {
      // Duplicate name: rename is refused; error notification to be added later.
      return;
    }
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, id: name } : track)),
          }
        : current,
    );
    this.dirty.set(true);
    if (this.selectedTrackId() === trackId) {
      this.selectedTrackId.set(name);
      this.selection.update((selection) => (selection ? { ...selection, trackId: name } : selection));
    }
    this.expandedTrackIds.update((ids) => {
      if (!ids.has(trackId)) {
        return ids;
      }
      const next = new Set(ids);
      next.delete(trackId);
      next.add(name);
      return next;
    });
  }

  setTrackTarget(trackId: string, serviceName: string, operationName: string): void {
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) =>
              track.id === trackId ? { ...track, serviceName, operationName } : track,
            ),
          }
        : current,
    );
    this.dirty.set(true);
  }

  /** Update a static (non keyframeable) parameter of a track modifier. */
  setStaticParam(trackId: string, name: string, value: number | string): void {
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) => {
              if (track.id !== trackId) {
                return track;
              }
              const modifier: ChaosModifierConfig = { ...track.modifier, [name]: value };
              return { ...track, modifier };
            }),
          }
        : current,
    );
    this.dirty.set(true);
  }

  setExperimentDuration(durationMs: number): void {
    const clamped = Math.max(1000, Math.round(durationMs));
    this.experiment.update((current) => {
      if (!current) {
        return current;
      }
      const oldDuration = current.durationMs;
      const tracks = current.tracks.map((track) => {
        const window = trackWindow(track, oldDuration);
        // A bound sitting on the old end follows the new end; the others are clamped into the duration.
        const endMs = window.endMs >= oldDuration ? clamped : Math.min(window.endMs, clamped);
        const startMs = Math.min(window.startMs, Math.max(0, endMs - 1));
        return {
          ...track,
          startMs,
          endMs,
          probability: this.reboundCurve(track.probability, oldDuration, clamped),
        };
      });
      return { ...current, durationMs: clamped, tracks };
    });
    this.dirty.set(true);
    this.setPlayhead(Math.min(this.playheadMs(), clamped), false);
  }

  /**
   * Adapt a curve to a new experiment duration: keyframes beyond the new duration are dropped, and a
   * keyframe sitting on the old duration (the usual end boundary) is moved to the new one, keeping its value.
   */
  private reboundCurve(curve: ChaosCurve, oldDuration: number, newDuration: number): ChaosCurve {
    const sorted = sortedKeyframes(curve);
    if (sorted.length === 0) {
      return { keyframes: [{ timeMs: 0, value: 0 }] };
    }
    const kept = sorted
      .filter((keyframe) => keyframe.timeMs < oldDuration && keyframe.timeMs <= newDuration)
      .map((keyframe) => ({ ...keyframe }));
    const endValue = sorted[sorted.length - 1].timeMs === oldDuration ? sorted[sorted.length - 1].value : null;
    if (endValue !== null && !kept.some((keyframe) => keyframe.timeMs === newDuration)) {
      kept.push({ timeMs: newDuration, value: endValue });
    }
    if (kept.length === 0) {
      return { keyframes: [{ timeMs: newDuration, value: sorted[0].value }] };
    }
    return { keyframes: kept };
  }

  // ---------------------------------------------------------------- Parameters and keyframes ----

  /** Live (interpolated) value of a track parameter at the playhead. */
  liveValue(trackId: string, param: ChaosParamKey): number | null {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return null;
    }
    if (param === 'probability') {
      return trackProbabilityAt(track, this.durationMs(), this.playheadMs());
    }
    return curveValueAt(getParamCurve(track, param), this.playheadMs());
  }

  /**
   * Set the value of a parameter. Animated parameters get a keyframe at the playhead; flat parameters
   * update their single constant keyframe.
   */
  setParamValue(trackId: string, param: ChaosParamKey, rawValue: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const value = this.clampValue(track, param, rawValue);
    const curve = getParamCurve(track, param);
    const timeMs = this.playheadMs();
    const keyframes = sortedKeyframes(curve);
    const existing = keyframes.find((keyframe) => keyframe.timeMs === timeMs);
    let updated: ChaosKeyframe[];
    if (!isParamAnimated(param, curve)) {
      // Flat parameter: edit the single constant keyframe, keeping its position.
      updated = [{ timeMs: keyframes[0]?.timeMs ?? 0, value }];
    } else if (existing) {
      updated = keyframes.map((keyframe) => (keyframe.timeMs === timeMs ? { ...keyframe, value } : keyframe));
    } else {
      updated = [...keyframes, { timeMs, value }].sort((a, b) => a.timeMs - b.timeMs);
    }
    this.updateCurve(trackId, param, { keyframes: updated });
  }

  /**
   * After Effects stopwatch: toggles the animation of a parameter. When animated, collapsing keeps the value
   * currently displayed at the playhead as the single constant keyframe.
   */
  toggleStopwatch(trackId: string, param: ChaosParamKey): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const curve = getParamCurve(track, param);
    if (isParamAnimated(param, curve)) {
      const value = curveValueAt(curve, this.playheadMs());
      let timeMs = this.playheadMs();
      if (param === 'probability') {
        // Keep the constant keyframe inside the active window so it stays meaningful.
        const window = trackWindow(track, this.durationMs());
        timeMs = clamp(timeMs, window.startMs, Math.max(window.startMs, window.endMs - 1));
      } else {
        timeMs = clamp(timeMs, 0, this.durationMs());
      }
      this.updateCurve(trackId, param, { keyframes: [{ timeMs, value }] });
    } else {
      // Enable animation: add a keyframe at the playhead (no-op when one already exists there).
      this.addKeyframeAtPlayhead(trackId, param);
    }
  }

  /** Diamond icon: add a keyframe at the playhead, or remove it when one already exists. */
  toggleKeyframeAtPlayhead(trackId: string, param: ChaosParamKey): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const timeMs = this.playheadMs();
    const curve = getParamCurve(track, param);
    const keyframes = sortedKeyframes(curve);
    const existingIndex = keyframes.findIndex((keyframe) => keyframe.timeMs === timeMs);
    if (existingIndex >= 0) {
      // The first keyframe anchors the curve start: it cannot be removed.
      if (existingIndex === 0 || keyframes.length <= minKeyframes(param)) {
        return;
      }
      this.updateCurve(trackId, param, {
        keyframes: keyframes.filter((keyframe) => keyframe.timeMs !== timeMs),
      });
    } else {
      this.addKeyframeAtPlayhead(trackId, param);
    }
  }

  hasKeyframeAtPlayhead(trackId: string, param: ChaosParamKey): boolean {
    const track = this.tracks().find((item) => item.id === trackId);
    const timeMs = this.playheadMs();
    return !!track && getParamCurve(track, param).keyframes.some((keyframe) => keyframe.timeMs === timeMs);
  }

  addKeyframeAtPlayhead(trackId: string, param: ChaosParamKey): void {
    this.addKeyframeAt(trackId, param, this.playheadMs());
  }

  /** Insert a keyframe at an arbitrary position, with the value the curve already has there. */
  addKeyframeAt(trackId: string, param: ChaosParamKey, timeMs: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    let time = snapToSecond(timeMs);
    if (param === 'probability') {
      // Probability keyframes live inside the active window.
      const window = trackWindow(track, this.durationMs());
      time = clamp(time, window.startMs, Math.max(window.startMs, window.endMs - 1));
    } else {
      time = clamp(time, 0, this.durationMs());
    }
    const curve = getParamCurve(track, param);
    const keyframes = sortedKeyframes(curve);
    if (keyframes.some((keyframe) => keyframe.timeMs === time)) {
      return;
    }
    const value = curveValueAt(curve, time);
    this.updateCurve(trackId, param, {
      keyframes: [...keyframes, { timeMs: time, value }].sort((a, b) => a.timeMs - b.timeMs),
    });
  }

  moveKeyframe(trackId: string, param: ChaosParamKey, index: number, timeMs: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const keyframes = sortedKeyframes(getParamCurve(track, param));
    if (index < 0 || index >= keyframes.length) {
      return;
    }
    // The first keyframe anchors the curve start: it cannot move in time.
    if (index === 0) {
      return;
    }
    let minTime = 0;
    let maxTime = this.durationMs();
    if (param === 'probability') {
      // Probability keyframes move within the active window (dormant ones can be dragged back inside).
      const window = trackWindow(track, this.durationMs());
      minTime = window.startMs;
      maxTime = Math.max(window.startMs, window.endMs - 1);
    }
    const lower = index > 0 ? Math.max(keyframes[index - 1].timeMs + 1, minTime) : minTime;
    const upper = index < keyframes.length - 1 ? Math.min(keyframes[index + 1].timeMs - 1, maxTime) : maxTime;
    const clamped = clamp(snapToSecond(timeMs), lower, upper);
    if (clamped === keyframes[index].timeMs) {
      return;
    }
    const updated = keyframes.map((keyframe, i) => (i === index ? { ...keyframe, timeMs: clamped } : keyframe));
    updated.sort((a, b) => a.timeMs - b.timeMs);
    this.updateCurve(trackId, param, { keyframes: updated });
    this.selection.update((selection) => {
      if (!selection || selection.trackId !== trackId || selection.param !== param) {
        return selection;
      }
      const stored = this.tracks().find((item) => item.id === trackId);
      const storedKeyframes = stored ? sortedKeyframes(getParamCurve(stored, param)) : updated;
      const newIndex = storedKeyframes.findIndex((keyframe) => keyframe.timeMs === clamped);
      return { ...selection, keyframeIndex: newIndex < 0 ? undefined : newIndex };
    });
  }

  setKeyframeValue(trackId: string, param: ChaosParamKey, index: number, rawValue: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const keyframes = sortedKeyframes(getParamCurve(track, param));
    if (index < 0 || index >= keyframes.length) {
      return;
    }
    const value = this.clampValue(track, param, rawValue);
    const timeMs = keyframes[index].timeMs;
    this.updateCurve(trackId, param, {
      keyframes: keyframes.map((keyframe) => (keyframe.timeMs === timeMs ? { ...keyframe, value } : keyframe)),
    });
  }

  removeSelectedKeyframe(): void {
    const selection = this.selection();
    if (!selection || selection.param === undefined || selection.keyframeIndex === undefined) {
      return;
    }
    const track = this.tracks().find((item) => item.id === selection.trackId);
    if (!track) {
      return;
    }
    const keyframes = sortedKeyframes(getParamCurve(track, selection.param));
    if (keyframes.length <= minKeyframes(selection.param)) {
      return;
    }
    // The first keyframe anchors the curve start: it cannot be removed.
    if (selection.keyframeIndex === 0) {
      return;
    }
    this.updateCurve(selection.trackId, selection.param, {
      keyframes: keyframes.filter((_, index) => index !== selection.keyframeIndex),
    });
    this.selection.set({ trackId: selection.trackId, param: selection.param });
  }

  /** Nudge the selected keyframe in time with the arrow keys. */
  nudgeSelectedKeyframe(deltaMs: number): void {
    const selection = this.selection();
    if (!selection || selection.param === undefined || selection.keyframeIndex === undefined) {
      return;
    }
    const track = this.tracks().find((item) => item.id === selection.trackId);
    if (!track) {
      return;
    }
    const keyframes = sortedKeyframes(getParamCurve(track, selection.param));
    const keyframe = keyframes[selection.keyframeIndex];
    if (keyframe) {
      this.moveKeyframe(selection.trackId, selection.param, selection.keyframeIndex, keyframe.timeMs + deltaMs);
    }
  }

  /** Shift the whole clip of a track (dragging the clip body): window and keyframes move together. */
  shiftTrack(trackId: string, deltaMs: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track || deltaMs === 0) {
      return;
    }
    const duration = this.durationMs();
    const window = trackWindow(track, duration);
    const shift = clamp(snapToSecond(deltaMs), -window.startMs, duration - window.endMs);
    if (shift === 0) {
      return;
    }
    const keyframes = sortedKeyframes(track.probability).map((keyframe) => ({
      ...keyframe,
      timeMs: clamp(keyframe.timeMs + shift, 0, duration),
    }));
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((item) =>
              item.id === trackId
                ? {
                    ...item,
                    startMs: window.startMs + shift,
                    endMs: window.endMs + shift,
                    probability: { keyframes: dedupeKeyframes(keyframes) },
                  }
                : item,
            ),
          }
        : current,
    );
    this.dirty.set(true);
  }

  /**
   * Trim the clip of a track from one of its edges. The clip bounds are explicit track fields, so trimming
   * just moves a boundary: it never touches the probability keyframes, which stay put and simply become
   * dormant when they fall outside the window (they light up again when the boundary comes back).
   */
  trimTrack(trackId: string, edge: 'start' | 'end', timeMs: number): void {
    const track = this.tracks().find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    const duration = this.durationMs();
    const window = trackWindow(track, duration);
    const target = snapToSecond(timeMs);
    if (edge === 'start') {
      const start = clamp(target, 0, window.endMs - SNAP_MS);
      this.setTrackWindow(trackId, start, window.endMs);
    } else {
      const end = clamp(target, window.startMs + SNAP_MS, duration);
      this.setTrackWindow(trackId, window.startMs, end);
    }
  }

  /** Replace the active window of a track. */
  setTrackWindow(trackId: string, startMs: number, endMs: number): void {
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) =>
              track.id === trackId ? { ...track, startMs, endMs } : track,
            ),
          }
        : current,
    );
    this.dirty.set(true);
  }

  selectKeyframe(trackId: string, param: ChaosParamKey, keyframeIndex: number): void {
    this.selectedTrackId.set(trackId);
    this.selection.set({ trackId, param, keyframeIndex });
  }

  /** Select a track parameter (row highlight) without pointing at a specific keyframe. */
  selectParam(trackId: string, param: ChaosParamKey): void {
    this.selectedTrackId.set(trackId);
    this.selection.set({ trackId, param });
  }

  private updateCurve(trackId: string, param: ChaosParamKey, curve: ChaosCurve): void {
    this.experiment.update((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) =>
              track.id === trackId ? withParamCurve(track, param, curve) : track,
            ),
          }
        : current,
    );
    this.dirty.set(true);
  }

  /** Clamp a parameter value into the catalog bounds, rounded to the fixed 0.01 granularity. */
  private clampValue(track: ChaosTrack, param: ChaosParamKey, value: number): number {
    const spec = this.paramsOfType(track.modifier.type).find((item) => item.key === param);
    if (!spec) {
      return value;
    }
    const rounded = Math.round(value * 100) / 100;
    return Math.min(spec.max, Math.max(spec.min, rounded));
  }

  // ---------------------------------------------------------------- Targets ----

  private loadServices(): void {
    const accumulate = (collected: Service[], page: number) => {
      this.servicesService.getServices(page, 100).subscribe({
        next: (services) => {
          const all = [...collected, ...services];
          if (services.length === 100 && page < 10) {
            accumulate(all, page + 1);
          } else {
            this.services.set(all.sort((a, b) => a.name.localeCompare(b.name)));
          }
        },
        error: () => {
          /* Error notification to be added later. */
        },
      });
    };
    accumulate([], 1);
  }

  operationsOf(serviceName: string | undefined): Operation[] {
    if (!serviceName) {
      return [];
    }
    const service = this.services().find((item) => item.name === serviceName);
    return service?.operations ?? [];
  }

  /** Fetch the modifier catalog and its parameter metadata from the backend. */
  private loadCatalog(): void {
    this.chaosService.listModifiers().subscribe({
      next: (catalog) => {
        if (catalog && catalog.length > 0) {
          this.modifierCatalog.set(catalog);
        }
      },
      error: () => {
        /* Error notification to be added later. */
      },
    });
  }
}
