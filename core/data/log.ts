export interface DevDataLogEvent {
  tableName?: string;
  name?: string;
  data?: any;
  [key: string]: any;
}

export type DevEventName = string;

export class DataLogger {
  private static instance: DataLogger;

  core: any;
  ideInfoPromise: any;
  ideSettingsPromise: any;

  static getInstance(): DataLogger {
    if (!DataLogger.instance) {
      DataLogger.instance = new DataLogger();
    }
    return DataLogger.instance;
  }

  async logDevData(_event: DevDataLogEvent): Promise<void> {
    // no-op stub
  }

  setConfig(_config: any): void {
    // no-op stub
  }
}
