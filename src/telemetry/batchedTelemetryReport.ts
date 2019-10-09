// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { OutcomeAndTime, TelemetryEntityProperties } from './telemetryReporter';

import groupBy = require('lodash.groupby');
import mapValues = require('lodash.mapValues');

export class OpsReportBatcher {
  private reports: UnbatchedOpReport[] = [];

  public add(report: UnbatchedOpReport) {
    this.reports.push(report);
  }

  public batched(): OpsReportBatch {
    const opsGroupedByName = groupBy(this.reports, report => report.operationName);
    const propertiesGroupedByName = mapValues(opsGroupedByName, manyOpsReports => manyOpsReports.map(operation => operation.properties));
    const opsByNameReport = mapValues(propertiesGroupedByName, propertiesSharingOpName => this.batchOpsSharingName(propertiesSharingOpName));
    const batch = new OpsReportBatch(opsByNameReport);
    this.reports = [];
    return batch;
  }

  public batchOpsSharingName(opsReports: TelemetryOperationProperties[]): OpsSharingNameReportBatch {
    const opsGroupedByOutcome = groupBy(opsReports, report => report.succesful);
    const succesfulOps = opsGroupedByOutcome['true'] ? this.batchOpsSharingNameAndOutcome(opsGroupedByOutcome['true'] || []) : undefined;
    const failedOps = opsGroupedByOutcome['false'] ? this.batchOpsSharingNameAndOutcome(opsGroupedByOutcome['false'] || []) : undefined;
    return new OpsSharingNameReportBatch(succesfulOps, failedOps);
  }

  public batchOpsSharingNameAndOutcome(opsReports: TelemetryOperationProperties[]): OpsSharingNameAndOutcomeReportBatch {
    const count = opsReports.length;
    const totalTime = opsReports.reduce((reduced, next) => reduced + next.time, 0);
    const maxTime = opsReports.reduce((reduced, next) => Math.max(reduced, next.time), -Infinity);
    const avgTime = totalTime / count;
    return new OpsSharingNameAndOutcomeReportBatch(totalTime, maxTime, avgTime, count, opsReports.map(report => report));
  }
}

export class UnbatchedOpReport {
  public constructor(public readonly operationName: string, public readonly properties: TelemetryOperationProperties) {}
}

export class OpsReportBatch {
  public constructor(public readonly byName: {[operationName: string]: OpsSharingNameReportBatch }) {}
}

export class OpsSharingNameReportBatch {
  public constructor(public readonly succesful: OpsSharingNameAndOutcomeReportBatch | undefined, public readonly failed: OpsSharingNameAndOutcomeReportBatch | undefined) {}
}

export class OpsSharingNameAndOutcomeReportBatch {
  public constructor(
    public readonly totalTime: number,
    public readonly maxTime: number,
    public readonly avgTime: number,
    public readonly count: number,
    public readonly breakdown: TelemetryOperationProperties[]
  ) {}
}

export type TelemetryOperationProperties = OutcomeAndTime & TelemetryEntityProperties;
