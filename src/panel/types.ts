export interface BrygeChatOptions {
  /** Which connected database (a Bryge datasource UUID) to answer from. Written by the
   *  app's setup page; also editable here if someone wants to point one panel elsewhere. */
  brygeDatasourceId: string;
  /** Shown as a one-click suggestion so an empty panel isn't a blank prompt. */
  starterQuestion: string;
  showChart: boolean;
  maxRows: number;
}
