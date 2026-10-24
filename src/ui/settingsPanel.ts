import { DIFFICULTIES, saveSettings, type Difficulty, type GameSettings } from '../ai/settings';

/**
 * Einstellungen oben rechts: Schwierigkeit, Kinder-Realismus („Bienenschwarm“),
 * Modus (selbst spielen / zuschauen) und Pause.
 */
export class SettingsPanel {
  private readonly pauseButton: HTMLButtonElement;
  private readonly pausedBadge: HTMLElement;

  constructor(
    private settings: GameSettings,
    private readonly onChange: (s: GameSettings) => void,
    private readonly onPause: () => void,
  ) {
    const root = document.createElement('div');
    root.className = 'settings';
    root.innerHTML = `
      <button class="toggle" type="button" aria-expanded="false" aria-controls="settings-body">Einstellungen</button>
      <button class="pause" type="button">Pause (P)</button>
      <div class="body" id="settings-body" hidden>
        <fieldset>
          <legend>Gegner</legend>
          <div class="segmented" role="radiogroup">
            ${(Object.keys(DIFFICULTIES) as Difficulty[])
              .map((d) => `<button type="button" data-difficulty="${d}">${DIFFICULTIES[d].label}</button>`)
              .join('')}
          </div>
        </fieldset>
        <fieldset>
          <legend>Kinder-Realismus</legend>
          <input id="swarm" type="range" min="0" max="100" step="5" />
          <div class="scale"><span>diszipliniert</span><span>Bienenschwarm</span></div>
        </fieldset>
        <fieldset>
          <legend>Modus</legend>
          <div class="segmented">
            <button type="button" data-mode="play">Ich spiele</button>
            <button type="button" data-mode="watch">Zuschauen</button>
          </div>
        </fieldset>
      </div>
      <div class="paused-badge" hidden>PAUSE</div>`;
    document.getElementById('hud')!.appendChild(root);

    const body = root.querySelector<HTMLElement>('.body')!;
    const toggle = root.querySelector<HTMLButtonElement>('.toggle')!;
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
    });
    this.pauseButton = root.querySelector<HTMLButtonElement>('.pause')!;
    this.pauseButton.addEventListener('click', () => this.onPause());
    this.pausedBadge = root.querySelector<HTMLElement>('.paused-badge')!;

    root.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((b) =>
      b.addEventListener('click', () => this.update({ difficulty: b.dataset.difficulty as Difficulty })),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => this.update({ humanPlays: b.dataset.mode === 'play' })),
    );
    const swarm = root.querySelector<HTMLInputElement>('#swarm')!;
    swarm.addEventListener('input', () => this.update({ swarm: Number(swarm.value) / 100 }));

    // Tastatureingaben im Panel nicht ans Spiel weitergeben
    root.addEventListener('keydown', (e) => e.stopPropagation());
    this.render(root);
  }

  setPaused(paused: boolean) {
    this.pausedBadge.hidden = !paused;
    this.pauseButton.textContent = paused ? 'Weiter (P)' : 'Pause (P)';
  }

  private update(change: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
    this.onChange(this.settings);
    this.render(document.querySelector('#hud .settings')!);
  }

  private render(root: Element) {
    root.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.difficulty === this.settings.difficulty)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String((b.dataset.mode === 'play') === this.settings.humanPlays)),
    );
    root.querySelector<HTMLInputElement>('#swarm')!.value = String(Math.round(this.settings.swarm * 100));
  }
}
