interface PhaseTiming {
  phase: string;
  phaseStarted: number;
  until: number;
}

/** Update phase timing together; callers retain motion and other transition effects. */
export function enterPhase<Scene extends PhaseTiming>(
  scene: Scene,
  phase: NoInfer<Scene["phase"]>,
  nowSeconds: number,
  durationSeconds: number,
): void {
  scene.phase = phase;
  scene.phaseStarted = nowSeconds;
  scene.until = nowSeconds + durationSeconds;
}
