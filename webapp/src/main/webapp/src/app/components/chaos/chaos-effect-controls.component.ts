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
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ChaosModifierParam, ChaosTrack } from '../../models/chaos.model';
import { ChaosEditorService } from './chaos-editor.service';
import {
  ChaosParamSpec,
  curveValueAt,
  formatTime,
  getParamCurve,
  isNumericParam,
  isParamAnimated,
  sortedKeyframes,
} from './chaos-editor.utils';
import { modifierIcon } from '../../models/chaos-modifiers';

/**
 * After Effects style effect controls panel: lists the modifiers of the experiment, lets the user add/remove
 * them, edit their target and parameters, and toggle keyframing with the stopwatch icon. Modifier types,
 * parameters and their config all come from the backend catalog. Parameter values always reflect the live
 * value at the playhead position.
 */
@Component({
  selector: 'app-chaos-effect-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chaos-effect-controls.component.html',
  styleUrls: ['./chaos-effect-controls.component.css'],
})
export class ChaosEffectControlsComponent {
  readonly editor = inject(ChaosEditorService);
  readonly isNumericParam = isNumericParam;

  readonly modifierCatalog = this.editor.modifierCatalog;

  readonly addOpen = signal(false);

  readonly selectedTrack = this.editor.selectedTrack;

  /** Keyframeable parameters of the selected modifier, from the backend catalog. */
  readonly keyframeableParams = computed(() => {
    const track = this.selectedTrack();
    return track ? this.editor.paramsOfType(track.modifier.type) : [];
  });

  /** Static (non keyframeable) parameters of the selected modifier, from the backend catalog. */
  readonly staticParams = computed(() => {
    const track = this.selectedTrack();
    return track ? this.editor.staticParamsOfType(track.modifier.type) : [];
  });

  toggleAdd(): void {
    this.addOpen.update((open) => !open);
  }

  addModifier(type: string): void {
    this.addOpen.set(false);
    this.editor.addTrackOfType(type);
  }

  onServiceChange(trackId: string, serviceName: string): void {
    this.editor.setTrackTarget(trackId, serviceName, '');
  }

  onOperationChange(trackId: string, serviceName: string | undefined, operationName: string): void {
    this.editor.setTrackTarget(trackId, serviceName || '', operationName);
  }

  onNameChange(trackId: string, name: string): void {
    this.editor.renameTrack(trackId, name);
  }

  /** A parameter is animated (stopwatch on) when it holds keyframes beyond its boundaries. */
  isAnimated(trackId: string, spec: ChaosParamSpec): boolean {
    const track = this.editor.tracks().find((item) => item.id === trackId);
    return !!track && isParamAnimated(spec.key, getParamCurve(track, spec.key));
  }

  keyframeCount(trackId: string, spec: ChaosParamSpec): number {
    const track = this.editor.tracks().find((item) => item.id === trackId);
    return track ? getParamCurve(track, spec.key).keyframes.length : 0;
  }

  hasKeyAtPlayhead(trackId: string, spec: ChaosParamSpec): boolean {
    return this.editor.hasKeyframeAtPlayhead(trackId, spec.key);
  }

  /** Keyframes of a parameter as percentages of the experiment duration, for the row mini strip. */
  keyframeMarkers(trackId: string, spec: ChaosParamSpec): { index: number; percent: number; atPlayhead: boolean }[] {
    const track = this.editor.tracks().find((item) => item.id === trackId);
    if (!track) {
      return [];
    }
    const duration = this.editor.durationMs();
    const playhead = this.editor.playheadMs();
    return sortedKeyframes(getParamCurve(track, spec.key)).map((keyframe, index) => ({
      index,
      percent: duration > 0 ? (keyframe.timeMs / duration) * 100 : 0,
      atPlayhead: keyframe.timeMs === playhead,
    }));
  }

  /** Click anywhere on the mini strip to move the playhead to that time. */
  seekFromStrip(event: MouseEvent, trackId: string): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.editor.setPlayhead(ratio * this.editor.durationMs());
  }

  /** Value displayed in the parameter input: the live value at the playhead when animated. */
  displayValue(trackId: string, spec: ChaosParamSpec): string {
    const track = this.editor.tracks().find((item) => item.id === trackId);
    if (!track) {
      return '';
    }
    const curve = getParamCurve(track, spec.key);
    const value = isParamAnimated(spec.key, curve)
      ? curveValueAt(curve, this.editor.playheadMs())
      : sortedKeyframes(curve)[0]?.value ?? 0;
    return spec.inputValue(value);
  }

  commitValue(trackId: string, spec: ChaosParamSpec, text: string): void {
    const parsed = spec.parseInput(text);
    if (!isNaN(parsed)) {
      this.editor.setParamValue(trackId, spec.key, parsed);
    }
  }

  /** Current value of a static parameter of the selected modifier. */
  staticValue(track: ChaosTrack, name: string): string {
    const value = track.modifier[name];
    return value === undefined || value === null ? '' : String(value);
  }

  /** Commit a static parameter: numbers are rounded to 0.01 and clamped to the catalog bounds. */
  onStaticChange(trackId: string, param: ChaosModifierParam, text: string): void {
    if (isNumericParam(param)) {
      const parsed = parseFloat(text);
      if (isNaN(parsed)) {
        return;
      }
      const value = Math.min(param.max as number, Math.max(param.min as number, Math.round(parsed * 100) / 100));
      this.editor.setStaticParam(trackId, param.name, value);
    } else {
      this.editor.setStaticParam(trackId, param.name, text);
    }
  }

  liveAtPlayhead(trackId: string, spec: ChaosParamSpec): string {
    const value = this.editor.liveValue(trackId, spec.key);
    if (value === null) {
      return '–';
    }
    return spec.format(value) + ' @ ' + formatTime(this.editor.playheadMs());
  }

  icon(type: string): string {
    return modifierIcon(type);
  }
}
