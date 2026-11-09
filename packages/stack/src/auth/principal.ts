export interface AgentPrincipal {
  readonly name: string;
  readonly forPerson: string;
}

export interface Principal {
  readonly subject: string;
  readonly orgId: string | null;
  readonly roles: ReadonlyArray<string>;
  readonly agent?: AgentPrincipal;
}
