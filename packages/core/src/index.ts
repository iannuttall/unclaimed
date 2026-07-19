export type { LivenessResult, SiteStatus } from "./liveness";
export { checkLiveness } from "./liveness";
export type {
  CheckResult,
  ForceSource,
  ResolverConfig,
  Source,
  Status,
  WhoisFn,
} from "./resolvers";
export {
  checkDomain,
  configureResolvers,
  setWhoisTransport,
} from "./resolvers";
export { techWords, words } from "./words";
