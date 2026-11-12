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
import { Component, ChangeDetectionStrategy, HostListener, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Vflow, CustomDynamicNodeComponent } from 'ngx-vflow';

import { modifierIcon } from '../../models/chaos-modifiers';
import { ChaosEditorService } from './chaos-editor.service';

/** Data carried by the nodes of the chaos target graph. */
export interface ChaosTargetNodeData {
  kind: 'user' | 'service' | 'operation';
  label: string;
  version?: string;
  serviceName?: string;
  operationName?: string;
  /** Number of experiment modifiers already targeting this node (wildcards included). */
  modifierCount?: number;
}

/**
 * Clickable node of the chaos target graph. Clicking (or right-clicking) a node opens a small
 * right-click-style dropdown where the modifier type is selected; the modifier is then created with this
 * node's target — exact for an operation, '*' wildcard for a whole service or for the external user.
 */
@Component({
  selector: 'app-chaos-target-node',
  standalone: true,
  imports: [Vflow, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="target-node kind-{{ data()?.kind }}" [class.menu-open]="menuOpen()">
      <div
        class="node-row"
        role="button"
        tabindex="0"
        (click)="toggleMenu($event)"
        (keydown.enter)="toggleMenu($event)"
        (contextmenu)="openMenu($event)"
        [title]="tooltip()"
      >
        <span class="node-icon {{ icon() }}"></span>
        <span class="node-label">{{ data()?.label }}</span>
        @if (data()?.version) {
          <span class="node-version">{{ data()?.version }}</span>
        }
        @if ((data()?.modifierCount ?? 0) > 0) {
          <span class="node-count" title="Modifiers already targeting this {{ data()?.kind }}">
            {{ data()?.modifierCount }}
          </span>
        }
        <span class="node-add" title="Add a modifier on this target"><span class="fa fa-plus"></span></span>
      </div>

      @if (menuOpen()) {
        <ul class="node-menu" role="menu">
          <li class="node-menu-title">Add modifier on:</li>
          <li class="node-menu-target">{{ menuTargetLabel() }}</li>
          @for (entry of catalog(); track entry.type) {
            <li>
              <button class="node-menu-item" role="menuitem" (click)="addModifier($event, entry.type)">
                <i class="fa {{ modifierIconClass(entry.type) }}" aria-hidden="true"></i>
                <span>{{ entry.label }}</span>
              </button>
            </li>
          }
        </ul>
      }

      <handle type="source" position="right" />
      @if (data()?.kind !== 'user') {
        <handle type="target" position="left" />
      }
    </div>
  `,
  styles: `
    .target-node {
      position: relative;
      min-width: 120px;
    }

    .node-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1.5px solid var(--graph-border, #ddd);
      background: var(--background, #fff);
      box-shadow: var(--card-box-shadow, 0 1px 1px rgba(3, 3, 3, 0.175));
      cursor: pointer;
      user-select: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .target-node.menu-open .node-row,
    .node-row:hover {
      border-color: var(--chaos-accent, #9c27b0);
      box-shadow: 0 0 0 2px var(--chaos-accent-soft, rgba(156, 39, 176, 0.12));
    }

    .node-row:focus-visible {
      outline: 2px solid var(--chaos-accent, #9c27b0);
      outline-offset: 1px;
    }

    .node-row.kind-user,
    .target-node.kind-user .node-row {
      border-color: var(--user-accent, #2e7d32);
      background: linear-gradient(135deg, var(--user-bg-start, #e8f5e9), var(--user-bg-end, #c8e6c9));
    }

    .target-node.kind-user .node-icon {
      color: var(--user-accent-dark, #1b5e20);
    }

    .target-node.kind-service .node-row {
      border-color: var(--service-accent, #1565c0);
      background: linear-gradient(135deg, var(--service-bg-start, #e3f2fd), var(--service-bg-end, #bbdefb));
    }

    .target-node.kind-service .node-icon {
      color: var(--service-accent-dark, #0d47a1);
    }

    .target-node.kind-operation .node-row {
      border-color: var(--operation-accent, #ef6c00);
      background: linear-gradient(135deg, var(--operation-bg-start, #fff3e0), var(--operation-bg-end, #ffe0b2));
    }

    .target-node.kind-operation .node-icon {
      color: var(--operation-accent-dark, #e65100);
    }

    .node-icon {
      font-size: 13px;
    }

    .node-label {
      font-weight: 600;
      font-size: 12px;
      color: var(--text-dark, #333);
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-version {
      font-size: 10px;
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
      padding: 0 5px;
    }

    .node-count {
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      background: var(--chaos-accent, #9c27b0);
      border-radius: 8px;
      padding: 1px 6px;
    }

    .node-add {
      margin-left: 2px;
      font-size: 11px;
      color: var(--chaos-accent, #9c27b0);
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .node-row:hover .node-add,
    .target-node.menu-open .node-add {
      opacity: 1;
    }

    /* Right-click style dropdown, rendered inside the card so the foreignObject never clips it. */
    .node-menu {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      z-index: 30;
      margin: 0;
      padding: 3px;
      list-style: none;
      min-width: 190px;
      background: var(--background, #fff);
      border: 1px solid var(--divider-muted, #ccc);
      border-radius: 4px;
      box-shadow: 0 3px 10px var(--shadow-medium, rgba(0, 0, 0, 0.175));
    }

    .node-menu-title {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted, #9c9c9c);
      padding: 3px 7px 1px;
    }

    .node-menu-target {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-strong, #363636);
      padding: 0 7px 4px;
      border-bottom: 1px solid var(--divider-light, #eaeaea);
      margin-bottom: 3px;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 5px 7px;
      border: 0;
      background: transparent;
      text-align: left;
      font-size: 12px;
      border-radius: 3px;
    }

    .node-menu-item:hover {
      background: var(--surface-hover, #edf8ff);
      text-decoration: none;
    }

    .node-menu-item .fa {
      color: var(--chaos-accent, #9c27b0);
    }
  `,
})
export class ChaosTargetNodeComponent extends CustomDynamicNodeComponent<ChaosTargetNodeData> {
  private editor = inject(ChaosEditorService);

  readonly catalog = this.editor.modifierCatalog;
  /** This node's key in the shared "open menu" state; derived so opening one node closes the others. */
  private readonly menuKey = computed(() => this.node().id);
  readonly menuOpen = computed(() => this.editor.openMenuNodeId() === this.menuKey());

  /** Open the right-click style dropdown (click or actual right-click); closes any other open one. */
  toggleMenu(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.editor.openMenuNodeId.set(this.menuOpen() ? null : this.menuKey());
  }

  openMenu(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.editor.openMenuNodeId.set(this.menuKey());
  }

  /** Any click outside the nodes closes every dropdown. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.editor.openMenuNodeId() !== null) {
      this.editor.openMenuNodeId.set(null);
    }
  }

  /** Create the chosen modifier on this node's target: exact for operations, '*' wildcard above. */
  addModifier(event: Event, type: string): void {
    event.stopPropagation();
    event.preventDefault();
    this.editor.openMenuNodeId.set(null);
    const data = this.data();
    if (!data) {
      return;
    }
    if (data.kind === 'user') {
      this.editor.addModifier(type, '*', '*');
    } else if (data.kind === 'service') {
      this.editor.addModifier(type, data.serviceName ?? '*', '*');
    } else {
      this.editor.addModifier(type, data.serviceName ?? '*', data.operationName ?? '*');
    }
  }

  menuTargetLabel(): string {
    const data = this.data();
    if (!data) {
      return '';
    }
    if (data.kind === 'user') {
      return '* / * (everything)';
    }
    if (data.kind === 'service') {
      return (data.serviceName ?? '*') + ' / * (all operations)';
    }
    return (data.serviceName ?? '*') + ' / ' + (data.operationName ?? '*');
  }

  modifierIconClass(type: string): string {
    return modifierIcon(type);
  }

  icon(): string {
    switch (this.data()?.kind) {
      case 'user':
        return 'fa fa-user';
      case 'service':
        return 'fa fa-cloud';
      default:
        return 'fa fa-cog';
    }
  }

  tooltip(): string {
    switch (this.data()?.kind) {
      case 'user':
        return 'Add a modifier targeting every service and operation (*)';
      case 'service':
        return 'Add a modifier targeting every operation of ' + this.data()?.label + ' (*)';
      default:
        return 'Add a modifier targeting ' + this.data()?.serviceName + ' / ' + this.data()?.label;
    }
  }
}

