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
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  WritableSignal,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3h from 'd3-hierarchy';
import { ComponentDynamicNode, Edge, Vflow, VflowComponent } from 'ngx-vflow';

import { Service } from '../../models/service.model';
import { ChaosEditorService } from './chaos-editor.service';
import { ChaosTargetNodeComponent, ChaosTargetNodeData } from './chaos-target-node.component';

/** Hierarchy node data structure used to compute the layout. */
interface TargetHierarchyNode {
  id: string;
  kind: 'user' | 'service' | 'operation';
  label: string;
  version?: string;
  serviceName?: string;
  operationName?: string;
  children?: TargetHierarchyNode[];
}

/**
 * Catalog graph of the Live Traces page: External User → APIs (services) → Operations. Clicking a node adds
 * a modifier targeting it — exact for an operation, '*' wildcard for a whole service or for the external
 * user (everything). Nodes show how many modifiers of the edited experiment already target them.
 */
@Component({
  selector: 'app-chaos-target-graph',
  standalone: true,
  imports: [CommonModule, Vflow],
  templateUrl: './chaos-target-graph.component.html',
  styleUrls: ['./chaos-target-graph.component.css'],
})
export class ChaosTargetGraphComponent implements AfterViewInit, OnDestroy {
  readonly editor = inject(ChaosEditorService);

  private readonly vflow = viewChild(VflowComponent);
  private readonly elementRef = inject(ElementRef);

  protected nodes: ComponentDynamicNode<ChaosTargetNodeData>[] = [];
  protected edges: Edge[] = [];

  private baseRadius = 280;
  private opRadius = 200;

  private dataSignals = new Map<string, WritableSignal<ChaosTargetNodeData>>();
  private builtFor = '';
  private visibilityObserver?: IntersectionObserver;
  private fittedWhenVisible = false;

  constructor() {
    // Rebuild the graph when the service catalog changes.
    effect(() => {
      const services = this.editor.services();
      const signature = services.map((service) => service.id).join('|');
      if (signature !== this.builtFor) {
        this.builtFor = signature;
        this.rebuild(services);
      }
    });
    // Refresh the modifier badges without rebuilding the graph.
    effect(() => {
      const counts = this.targetCounts();
      this.dataSignals.forEach((dataSignal, id) => {
        const count = counts.get(id) ?? 0;
        dataSignal.update((data) => (data.modifierCount === count ? data : { ...data, modifierCount: count }));
      });
    });
  }

  /** Count the modifiers of the edited experiment per graph node. */
  private targetCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const track of this.editor.tracks()) {
      if (track.serviceName === '*') {
        bump('user');
      } else if (track.serviceName) {
        bump('svc:' + track.serviceName);
        if (track.operationName === '*') {
          continue;
        }
        if (track.operationName) {
          bump('op:' + track.serviceName + ':' + track.operationName);
        }
      }
    }
    return counts;
  }

  /** The Chaos tab renders hidden: fit the graph the first time it becomes actually visible. */
  ngAfterViewInit(): void {
    this.visibilityObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !this.fittedWhenVisible) {
        this.fittedWhenVisible = true;
        setTimeout(() => this.vflow()?.fitView({ duration: 200 }), 50);
      }
    });
    this.visibilityObserver.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.visibilityObserver?.disconnect();
  }

  /** Rebuild the whole tree from the service catalog. */
  private rebuild(services: Service[]): void {
    const children: TargetHierarchyNode[] = [];
    for (const service of services) {
      children.push({
        id: 'svc:' + service.name,
        kind: 'service',
        label: service.name,
        version: service.version,
        serviceName: service.name,
        children: (service.operations ?? []).map((operation) => ({
          id: 'op:' + service.name + ':' + operation.name,
          kind: 'operation' as const,
          label: operation.name,
          serviceName: service.name,
          operationName: operation.name,
        })),
      });
    }

    const data: TargetHierarchyNode = {
      id: 'user',
      kind: 'user',
      label: 'External User',
      children,
    };

    const root = d3h.hierarchy(data);
    const leaves = root.leaves().length;
    const treeWidth = this.baseRadius + this.opRadius;
    const treeHeight = Math.max(600, leaves * 56 + services.length * 40);
    d3h
      .tree<any>()
      .size([treeHeight, treeWidth])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2))(root);

    this.nodes = [];
    this.edges = [];
    this.dataSignals.clear();

    root.descendants().forEach((nd) => {
      const payload: ChaosTargetNodeData = {
        kind: nd.data.kind,
        label: nd.data.label,
        version: nd.data.version,
        serviceName: nd.data.serviceName,
        operationName: nd.data.operationName,
        modifierCount: 0,
      };
      const dataSignal = signal(payload);
      this.dataSignals.set(nd.data.id, dataSignal);
      this.nodes.push({
        id: nd.data.id,
        point: signal({ x: (nd.y as number) || 0, y: (nd.x as number) || 0 }),
        type: ChaosTargetNodeComponent,
        data: dataSignal,
        draggable: signal(true),
      });
    });

    root.links().forEach((lnk) => {
      this.edges.push({
        id: (lnk.source.data as TargetHierarchyNode).id + '->' + (lnk.target.data as TargetHierarchyNode).id,
        source: (lnk.source.data as TargetHierarchyNode).id,
        target: (lnk.target.data as TargetHierarchyNode).id,
      });
    });

    const hasFinite = this.nodes.every(
      (node) => Number.isFinite(node.point().x) && Number.isFinite(node.point().y),
    );
    if (this.nodes.length > 1 && hasFinite) {
      setTimeout(() => this.vflow()?.fitView({ duration: 300 }), 200);
    }
  }
}
