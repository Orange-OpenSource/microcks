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
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ChaosEditorService } from './chaos-editor.service';
import {
  ChaosParamKey,
  formatTick,
  formatTime,
  getParamCurve,
  niceTickMs,
  sortedKeyframes,
  stepCurvePath,
  trackColor,
  trackProbabilityAt,
  trackWindow,
} from './chaos-editor.utils';

/** One keyframe as rendered in a parameter lane. */
interface KeyframeMarker {
  index: number;
  timeMs: number;
  value: number;
  px: number;
  /** True when the keyframe sits outside the active window of the track (kept but inactive). */
  dormant: boolean;
}

/** One expanded parameter lane of a track. */
interface ParamLane {
  key: ChaosParamKey;
  label: string;
  keyframes: KeyframeMarker[];
  /** SVG path of the STEP curve drawn behind the keyframes. */
  curvePath: string;
  /** Closed variant of the curve path used as a subtle area fill. */
  areaPath: string;
}

/** One track row of the timeline. */
interface TrackRow {
  id: string;
  index: number;
  color: string;
  serviceName: string;
  operationName: string;
  startPx: number;
  endPx: number;
  widthPx: number;
  expanded: boolean;
  /** True when the track has keyframeable parameters beyond probability, so it can be expanded. */
  hasParams: boolean;
  livePercent: number;
  /** Probability curve and keyframes, drawn directly on the track row. */
  probabilityCurve: string;
  probabilityArea: string;
  probabilityKeyframes: KeyframeMarker[];
  /** Lanes of the extra (non probability) parameters, shown when the track is expanded. */
  params: ParamLane[];
}

/**
 * After Effects style timeline: a left column with the modifier layers (rename, expand) and, on the right,
 * a scrubable ruler, draggable modifier clips (start/end trims and whole-clip moves) and draggable
 * keyframe diamonds for each keyframeable parameter.
 */
@Component({
  selector: 'app-chaos-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chaos-timeline.component.html',
  styleUrls: ['./chaos-timeline.component.css'],
})
export class ChaosTimelineComponent {
  readonly editor = inject(ChaosEditorService);

  readonly HEADER_WIDTH = 280;
  readonly RULER_HEIGHT = 30;
  readonly TRACK_ROW_HEIGHT = 40;
  readonly PARAM_ROW_HEIGHT = 36;

  /** Horizontal scale of the timeline in pixels per millisecond. */
  readonly pxPerMs = signal(0.08);
  readonly renamingTrackId = signal<string | null>(null);
  renameValue = '';

  private readonly scrollContainer = viewChild.required<ElementRef<HTMLDivElement>>('scrollContainer');
  private readonly rulerElement = viewChild.required<ElementRef<HTMLDivElement>>('rulerElement');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /** Id of the experiment the view was last fitted for, so the default fitted view applies per experiment. */
  private fittedExperimentId: string | null = null;

  constructor() {
    // Focus and select the rename input as soon as it is rendered.
    effect(() => {
      if (this.renamingTrackId() !== null) {
        const input = this.renameInput()?.nativeElement;
        if (input) {
          input.focus();
          input.select();
        }
      }
    });
    // The default view fits the whole duration into the visible width. It is applied once an experiment is
    // loaded (duration and layout are known then) and reapplied when another experiment is loaded.
    effect(() => {
      const id = this.editor.experiment()?.id ?? null;
      if (id === this.fittedExperimentId) {
        return;
      }
      this.fittedExperimentId = id;
      // Defer to the next frame so the scroll container has its final layout.
      requestAnimationFrame(() => this.fit());
    });
  }

  readonly durationMs = this.editor.durationMs;
  readonly playheadMs = this.editor.playheadMs;
  readonly playheadPx = computed(() => this.playheadMs() * this.pxPerMs());
  readonly laneWidth = computed(() => Math.max(300, this.durationMs() * this.pxPerMs()));

  readonly ticks = computed(() => {
    const pxPerMs = this.pxPerMs();
    const duration = this.durationMs();
    const step = niceTickMs(pxPerMs);
    const ticks: { timeMs: number; label: string; px: number }[] = [];
    for (let timeMs = 0; timeMs <= duration; timeMs += step) {
      ticks.push({ timeMs, label: formatTick(timeMs), px: timeMs * pxPerMs });
    }
    return ticks;
  });

  readonly rows = computed<TrackRow[]>(() => {
    const duration = this.durationMs();
    const pxPerMs = this.pxPerMs();
    const playhead = this.playheadMs();
    return this.editor.tracks().map((track, index) => {
      const window = trackWindow(track, duration);
      const expanded = this.editor.isExpanded(track.id);

      // The probability curve lives on the track row itself, where the clip is: inactive outside the window.
      const probabilityCurve = stepCurvePath(
        track.probability,
        duration,
        duration * pxPerMs,
        this.TRACK_ROW_HEIGHT,
        0,
        1,
        window,
      );
      const sortedProbability = sortedKeyframes(track.probability);
      // The first keyframe anchors the curve start: it is implicit and not rendered.
      const probabilityKeyframes = sortedProbability
        .map((keyframe, kfIndex) => ({
          index: kfIndex,
          timeMs: keyframe.timeMs,
          value: keyframe.value,
          px: keyframe.timeMs * pxPerMs,
          dormant: keyframe.timeMs < window.startMs || keyframe.timeMs >= window.endMs,
        }))
        .filter((marker) => marker.index > 0);
      const probabilityArea =
        probabilityCurve && sortedProbability.length > 0
          ? probabilityCurve +
            ' L ' +
            duration * pxPerMs +
            ' ' +
            this.TRACK_ROW_HEIGHT +
            ' L ' +
            sortedProbability[0].timeMs * pxPerMs +
            ' ' +
            this.TRACK_ROW_HEIGHT +
            ' Z'
          : '';

      // Expanded lanes only carry the parameters that are not already shown on the track row.
      const extraParams = this.editor
        .paramsOfType(track.modifier.type)
        .filter((spec) => spec.key !== 'probability');
      const params: ParamLane[] = expanded
        ? extraParams.map((spec) => {
            const curve = getParamCurve(track, spec.key);
            const laneWidth = duration * pxPerMs;
            const curvePath = stepCurvePath(
              curve,
              duration,
              laneWidth,
              this.PARAM_ROW_HEIGHT,
              spec.min,
              spec.max,
            );
            const keyframes = sortedKeyframes(curve);
            const areaPath =
              curvePath && keyframes.length > 0
                ? curvePath +
                  ' L ' +
                  laneWidth +
                  ' ' +
                  this.PARAM_ROW_HEIGHT +
                  ' L ' +
                  keyframes[0].timeMs * pxPerMs +
                  ' ' +
                  this.PARAM_ROW_HEIGHT +
                  ' Z'
                : '';
            return {
              key: spec.key,
              label: spec.label,
              // The first keyframe anchors the curve start: it is implicit and not rendered, same as on the track row.
              keyframes: keyframes
                .map((keyframe, kfIndex) => ({
                  index: kfIndex,
                  timeMs: keyframe.timeMs,
                  value: keyframe.value,
                  px: keyframe.timeMs * pxPerMs,
                  dormant: false,
                }))
                .filter((marker) => marker.index > 0),
              curvePath,
              areaPath,
            };
          })
        : [];
      return {
        id: track.id,
        index,
        color: trackColor(index),
        serviceName: track.serviceName ?? '',
        operationName: track.operationName ?? '',
        startPx: window.startMs * pxPerMs,
        endPx: window.endMs * pxPerMs,
        widthPx: Math.max(0, (window.endMs - window.startMs) * pxPerMs),
        expanded,
        hasParams: extraParams.length > 0,
        livePercent: Math.round(trackProbabilityAt(track, duration, playhead) * 100),
        probabilityCurve,
        probabilityArea,
        probabilityKeyframes,
        params,
      };
    });
  });

  readonly contentHeight = computed(
    () =>
      this.RULER_HEIGHT +
      this.rows().reduce(
        (total, row) => total + this.TRACK_ROW_HEIGHT + (row.expanded ? row.params.length * this.PARAM_ROW_HEIGHT : 0),
        0,
      ),
  );

  readonly selection = this.editor.selection;

  formatTime = formatTime;

  // ---------------------------------------------------------------- Zoom ----

  zoomIn(): void {
    this.pxPerMs.update((value) => Math.min(1, value * 1.5));
  }

  zoomOut(): void {
    this.pxPerMs.update((value) => Math.max(0.002, value / 1.5));
  }

  fit(): void {
    const available = this.scrollContainer().nativeElement.clientWidth - this.HEADER_WIDTH - 24;
    if (available > 100 && this.durationMs() > 0) {
      this.pxPerMs.set(available / this.durationMs());
    }
  }

  // ---------------------------------------------------------------- Playhead scrubbing ----

  startScrub(event: MouseEvent): void {
    event.preventDefault();
    this.editor.setPlayhead(this.timeAt(event.clientX));
    const move = (moveEvent: MouseEvent) => this.editor.setPlayhead(this.timeAt(moveEvent.clientX));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /** Timeline time (ms) for a viewport x coordinate, using the ruler origin. */
  private timeAt(clientX: number): number {
    const rect = this.rulerElement().nativeElement.getBoundingClientRect();
    const offset = clientX - rect.left;
    return Math.max(0, Math.min(this.durationMs(), offset / this.pxPerMs()));
  }

  // ---------------------------------------------------------------- Clips ----

  selectRow(row: TrackRow): void {
    this.editor.selectTrack(row.id);
  }

  /** Clicking an empty lane area selects the track and moves the playhead to that position. */
  onLaneMouseDown(event: MouseEvent, row: TrackRow): void {
    this.selectRow(row);
    this.startScrub(event);
  }

  onClipMouseDown(event: MouseEvent, row: TrackRow): void {
    event.stopPropagation();
    this.editor.selectTrack(row.id);
    let lastX = event.clientX;
    let pending = 0;
    const move = (moveEvent: MouseEvent) => {
      pending += (moveEvent.clientX - lastX) / this.pxPerMs();
      lastX = moveEvent.clientX;
      // Everything snaps to whole seconds: only emit once a full second of movement has accumulated.
      const snapped = Math.round(pending / 1000) * 1000;
      if (snapped !== 0) {
        this.editor.shiftTrack(row.id, snapped);
        pending -= snapped;
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  onEdgeMouseDown(event: MouseEvent, row: TrackRow, edge: 'start' | 'end'): void {
    event.stopPropagation();
    event.preventDefault();
    this.editor.selectTrack(row.id);
    const track = this.editor.tracks().find((item) => item.id === row.id);
    if (!track) {
      return;
    }
    const window = trackWindow(track, this.durationMs());
    const origin = edge === 'start' ? window.startMs : window.endMs;
    const startX = event.clientX;
    const move = (moveEvent: MouseEvent) => {
      const time = origin + (moveEvent.clientX - startX) / this.pxPerMs();
      this.editor.trimTrack(row.id, edge, time);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // ---------------------------------------------------------------- Track reordering ----

  readonly draggingTrackId = signal<string | null>(null);
  readonly dropIndex = signal<number | null>(null);

  /** Snapshot of the visible track rows at drag start: id and viewport geometry. */
  private reorderRows: { id: string; top: number; height: number }[] = [];

  /**
   * Start dragging a track by its header grip. The mousemove position is compared against the midpoints
   * of the visible track rows to compute the insertion index; the drop happens on mouseup.
   */
  startReorder(event: MouseEvent, row: TrackRow): void {
    event.preventDefault();
    event.stopPropagation();
    this.editor.selectTrack(row.id);
    this.draggingTrackId.set(row.id);
    this.reorderRows = Array.from(document.querySelectorAll<HTMLElement>('.tl-row.track-row')).map((el) => {
      const rect = el.getBoundingClientRect();
      return { id: el.getAttribute('data-track-id') ?? '', top: rect.top, height: rect.height };
    });
    this.updateDropIndex(event.clientY);
    document.body.style.cursor = 'grabbing';
    const move = (moveEvent: MouseEvent) => this.updateDropIndex(moveEvent.clientY);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      const from = this.draggingTrackId();
      const to = this.dropIndex();
      if (from !== null && to !== null) {
        this.editor.reorderTrack(from, to);
      }
      this.draggingTrackId.set(null);
      this.dropIndex.set(null);
      this.reorderRows = [];
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /** Insertion index = number of track-row midpoints above the pointer. */
  private updateDropIndex(clientY: number): void {
    if (this.reorderRows.length === 0) {
      this.dropIndex.set(null);
      return;
    }
    let index = 0;
    for (const row of this.reorderRows) {
      if (clientY > row.top + row.height / 2) {
        index++;
      }
    }
    this.dropIndex.set(index);
  }

  // ---------------------------------------------------------------- Keyframes ----

  onKeyframeMouseDown(event: MouseEvent, row: TrackRow, param: ChaosParamKey, keyframe: KeyframeMarker): void {
    event.stopPropagation();
    event.preventDefault();
    this.editor.selectKeyframe(row.id, param, keyframe.index);
    const startX = event.clientX;
    const origin = keyframe.timeMs;
    const move = (moveEvent: MouseEvent) => {
      const time = origin + (moveEvent.clientX - startX) / this.pxPerMs();
      this.editor.moveKeyframe(row.id, param, keyframe.index, time);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  isKeyframeSelected(row: TrackRow, param: ChaosParamKey, index: number): boolean {
    const selection = this.selection();
    return (
      !!selection &&
      selection.trackId === row.id &&
      selection.param === param &&
      selection.keyframeIndex === index
    );
  }

  onLaneDblClick(event: MouseEvent, row: TrackRow, param: ChaosParamKey): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const time = Math.max(0, Math.min(this.durationMs(), (event.clientX - rect.left) / this.pxPerMs()));
    this.editor.addKeyframeAt(row.id, param, time);
  }

  // ---------------------------------------------------------------- Rename ----

  startRename(row: TrackRow): void {
    this.renamingTrackId.set(row.id);
    this.renameValue = row.id;
  }

  commitRename(): void {
    const trackId = this.renamingTrackId();
    if (trackId !== null) {
      this.editor.renameTrack(trackId, this.renameValue);
    }
    this.renamingTrackId.set(null);
  }

  cancelRename(event: Event): void {
    event.stopPropagation();
    this.renamingTrackId.set(null);
  }

  removeTrack(event: Event, row: TrackRow): void {
    event.stopPropagation();
    this.editor.removeTrack(row.id);
  }
}
