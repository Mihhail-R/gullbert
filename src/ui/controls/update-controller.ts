export interface UpdateState {
  busy: boolean;
  available: boolean;
  status: string;
  notes: string;
  progress: number | null;
}
interface Dependencies {
  check(beta: boolean): Promise<{ version: string; notes: string } | null>;
  install(): Promise<void>;
  render(state: UpdateState): void;
}
/** Owns the checked release and prevents overlapping checks/installations. */
export class UpdateController {
  #dependencies: Dependencies;
  #state: UpdateState = {
    busy: false,
    available: false,
    status: "Check for a newer Gullbert release.",
    notes: "",
    progress: null,
  };
  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }
  reset() {
    if (this.#state.busy) {
      return;
    }
    this.#publish({
      available: false,
      notes: "",
      status: "Check for a newer Gullbert release.",
      progress: null,
    });
  }
  async check(beta: boolean) {
    if (this.#state.busy) {
      return;
    }
    this.#publish({
      busy: true,
      available: false,
      notes: "",
      progress: null,
      status: "Checking GitHub…",
    });
    try {
      const update = await this.#dependencies.check(beta);
      if (update) {
        this.#publish({
          available: true,
          notes: update.notes,
          status: `Gullbert ${update.version} is available.`,
        });
      } else {
        this.#publish({
          status: "You’re up to date for this release channel.",
        });
      }
    } catch (error) {
      this.#publish({ status: String(error) });
    } finally {
      this.#publish({ busy: false });
    }
  }
  async install() {
    if (this.#state.busy || !this.#state.available) {
      return;
    }
    this.#publish({
      busy: true,
      available: false,
      status: "Downloading update…",
      progress: 0,
    });
    try {
      await this.#dependencies.install();
      this.#publish({ status: "Restarting Gullbert…" });
    } catch (error) {
      this.#publish({ busy: false, progress: null, status: String(error) });
    }
  }
  progress(downloaded: number, total: number | null, installing: boolean) {
    if (!this.#state.busy) {
      return;
    }
    if (installing) {
      this.#publish({
        status: "Verifying and installing update…",
        progress: null,
      });
    } else if (total && total > 0) {
      const progress = Math.min(1, downloaded / total);
      this.#publish({
        status: `Downloading update… ${Math.round(progress * 100)}%`,
        progress,
      });
    } else {
      this.#publish({
        status: `Downloading update… ${Math.round(downloaded / 1024)} KB`,
        progress: null,
      });
    }
  }
  #publish(change: Partial<UpdateState>) {
    this.#state = { ...this.#state, ...change };
    this.#dependencies.render({ ...this.#state });
  }
}
