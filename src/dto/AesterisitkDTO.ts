export class AesterisitkDTO {
  build: Build;
  system: System;
  config: Config;
  status: Status;
}

export class Build {
  os: string;
  kernel: string;
  machine: string;
  options: string;
  date: string;
  user: string;
}

export class Config {
  name: string;
  default_language: string;
  setid: Setid;
}

export class Setid {
  user: string;
  group: string;
}

export class Status {
  startup_time: string;
  last_reload_time: string;
}

export class System {
  version: string;
  entity_id: string;
}
