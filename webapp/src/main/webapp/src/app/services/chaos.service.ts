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
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ChaosExperiment,
  ChaosModifierDescriptor,
  ExperimentState,
} from '../models/chaos.model';

@Injectable({ providedIn: 'root' })
export class ChaosService {
  private rootUrl = '/api/chaos';

  constructor(private http: HttpClient) {}

  public listModifiers(): Observable<ChaosModifierDescriptor[]> {
    return this.http.get<ChaosModifierDescriptor[]>(this.rootUrl + '/modifiers');
  }

  public listExperiments(state?: ExperimentState): Observable<ChaosExperiment[]> {
    let params = new HttpParams();
    if (state) {
      params = params.set('state', state);
    }
    return this.http.get<ChaosExperiment[]>(this.rootUrl + '/experiments', {
      params,
    });
  }

  public getExperiment(id: string): Observable<ChaosExperiment> {
    return this.http.get<ChaosExperiment>(
      this.rootUrl + '/experiments/' + id
    );
  }

  public createExperiment(
    experiment: ChaosExperiment
  ): Observable<ChaosExperiment> {
    return this.http.post<ChaosExperiment>(
      this.rootUrl + '/experiments',
      experiment
    );
  }

  public updateExperiment(
    experiment: ChaosExperiment
  ): Observable<ChaosExperiment> {
    return this.http.put<ChaosExperiment>(
      this.rootUrl + '/experiments/' + experiment.id,
      experiment
    );
  }

  public startExperiment(id: string): Observable<ChaosExperiment> {
    return this.postAction(id, 'start');
  }

  public stopExperiment(id: string): Observable<ChaosExperiment> {
    return this.postAction(id, 'stop');
  }

  public deleteExperiment(id: string): Observable<void> {
    return this.http.delete<void>(this.rootUrl + '/experiments/' + id);
  }

  private postAction(id: string, action: string): Observable<ChaosExperiment> {
    return this.http.post<ChaosExperiment>(
      this.rootUrl + '/experiments/' + id + '/' + action,
      null
    );
  }
}
