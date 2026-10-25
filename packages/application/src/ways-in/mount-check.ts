export type FetchHandler = ((request: Request) => Promise<Response>) &
  Readonly<{ dispose: () => Promise<void> }>;

export type ServicesCheck<Needed, Provided> = [Exclude<Needed, Provided>] extends [never]
  ? unknown
  : Readonly<{ missingServices: Exclude<Needed, Provided> }>;
