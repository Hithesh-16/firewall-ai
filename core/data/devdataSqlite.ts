export class DevDataSqliteDb {
  static async logTokensGenerated(
    _model: string,
    _provider: string,
    _promptTokens: number,
    _generatedTokens: number,
  ): Promise<void> {
    // no-op stub
  }

  static async getTokensPerDay(): Promise<any[]> {
    return [];
  }

  static async getTokensPerModel(): Promise<any[]> {
    return [];
  }
}
