import { setWhoisTransport } from "@unclaimed/core";
import { whoisQuery } from "./whois-node";

setWhoisTransport(whoisQuery);

export type {
  CheckResult,
  ForceSource,
  LivenessResult,
  ResolverConfig,
  Source,
  Status,
} from "@unclaimed/core";
export {
  checkDomain,
  checkLiveness,
  configureResolvers,
  setWhoisTransport,
  techWords,
  words,
} from "@unclaimed/core";
