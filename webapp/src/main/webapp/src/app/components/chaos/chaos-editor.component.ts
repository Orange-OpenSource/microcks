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
import { Component, ElementRef, OnDestroy, HostListener, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ExperimentState } from '../../models/chaos.model';
import { ChaosEditorService } from './chaos-editor.service';
import { formatSeconds, formatTime, parseSeconds } from './chaos-editor.utils';
import { ChaosTargetGraphComponent } from './chaos-target-graph.component';
import { ChaosEffectControlsComponent } from './chaos-effect-controls.component';
import { ChaosTimelineComponent } from './chaos-timeline.component';

/**
 * Chaos editor embedded in the Live Traces page as a tab. It follows the After Effects workflow:
 * a right-hand effect controls panel to manage modifiers and their keyframes, and a bottom timeline
 * to arrange modifier spans and keyframes over the experiment duration.
 */
@Component({
  selector: 'app-chaos-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ChaosTargetGraphComponent, ChaosEffectControlsComponent, ChaosTimelineComponent],
  providers: [ChaosEditorService],
  templateUrl: './chaos-editor.component.html',
  styleUrls: ['./chaos-editor.component.css'],
})
export class ChaosEditorComponent implements OnDestroy {
  readonly editor = inject(ChaosEditorService);
  private readonly elementRef = inject(ElementRef);

  readonly ExperimentState = ExperimentState;
  readonly formatTime = formatTime;

  /** Inline creation form visibility. */
  readonly creating = signal(false);
  newExperimentName = '';
  newExperimentSeconds = '60';

  /** Id of the experiment the creation form was opened for; undefined before the first load. */
  private creationFormExperimentId: string | null | undefined = undefined;

  constructor() {
    // Dismiss and clear the inline creation form whenever the edited experiment changes
    // (selector switch, back/forward navigation or deep link).
    effect(() => {
      const id = this.editor.experiment()?.id ?? null;
      if (this.creationFormExperimentId !== undefined && id !== this.creationFormExperimentId) {
        this.creating.set(false);
        this.newExperimentName = '';
        this.newExperimentSeconds = '60';
      }
      this.creationFormExperimentId = id;
    });
  }

  /** Timeline pane height, resizable through the separator drag handle. */
  readonly timelineHeight = signal(280);

  /** Effect controls pane width, resizable by dragging its left border. */
  readonly effectsWidth = signal(340);

  private resizingEffects = false;
  private startX = 0;
  private startEffectsWidth = 0;

  private resizing = false;
  private startY = 0;
  private startHeight = 0;

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
    document.removeEventListener('mousemove', this.onEffectsResizeMove);
    document.removeEventListener('mouseup', this.onEffectsResizeEnd);
  }

  openCreationForm(): void {
    this.creating.set(true);
  }

  closeCreationForm(): void {
    this.creating.set(false);
  }

  submitCreation(): void {
    const name = this.newExperimentName.trim();
    const durationMs = parseSeconds(this.newExperimentSeconds) || 60000;
    if (!name) {
      return;
    }
    this.editor.createExperiment(name, durationMs);
    this.newExperimentName = '';
    this.creating.set(false);
  }

  onNameChange(name: string): void {
    this.editor.renameExperiment(name);
  }

  /** Switch the edited experiment; the select value is driven by the [ngModel] binding. */
  onExperimentSelect(id: string): void {
    if (!id) {
      return;
    }
    this.editor.selectExperiment(id);
  }

  onDurationChange(text: string): void {
    const ms = parseSeconds(text);
    if (ms > 0) {
      this.editor.setExperimentDuration(ms);
    }
  }

  // ------------------------------------------------------------- Timeline resize ----

  startTimelineResize(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.startY = event.clientY;
    this.startHeight = this.timelineHeight();
    document.addEventListener('mousemove', this.onResizeMove);
    document.addEventListener('mouseup', this.onResizeEnd);
  }

  private readonly onResizeMove = (event: MouseEvent): void => {
    if (!this.resizing) {
      return;
    }
    const height = this.startHeight + (this.startY - event.clientY);
    this.timelineHeight.set(Math.max(160, Math.min(560, height)));
  };

  private readonly onResizeEnd = (): void => {
    this.resizing = false;
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
  };

  // ------------------------------------------------------------- Effects panel resize ----

  startEffectsResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizingEffects = true;
    this.startX = event.clientX;
    this.startEffectsWidth = this.effectsWidth();
    document.addEventListener('mousemove', this.onEffectsResizeMove);
    document.addEventListener('mouseup', this.onEffectsResizeEnd);
  }

  private readonly onEffectsResizeMove = (event: MouseEvent): void => {
    if (!this.resizingEffects) {
      return;
    }
    const width = this.startEffectsWidth + (this.startX - event.clientX);
    this.effectsWidth.set(Math.max(280, Math.min(640, width)));
  };

  private readonly onEffectsResizeEnd = (): void => {
    this.resizingEffects = false;
    document.removeEventListener('mousemove', this.onEffectsResizeMove);
    document.removeEventListener('mouseup', this.onEffectsResizeEnd);
  };

  /** Delete key removes the currently selected keyframe, unless the user is typing in a field or the tab is hidden. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!(this.elementRef.nativeElement as HTMLElement).offsetParent) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.editor.selection()) {
      event.preventDefault();
      this.editor.removeSelectedKeyframe();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && this.editor.selection()) {
      event.preventDefault();
      const step = event.shiftKey ? 10000 : 1000;
      this.editor.nudgeSelectedKeyframe(event.key === 'ArrowLeft' ? -step : step);
    }
  }

  durationText(): string {
    return formatSeconds(this.editor.durationMs());
  }
}
