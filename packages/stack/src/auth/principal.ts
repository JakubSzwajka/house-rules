export interface Principal {
  readonly subject: string;
  readonly orgId: string | null;
  readonly roles: ReadonlyArray<string>;
}
