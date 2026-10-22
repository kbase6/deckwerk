import type { Slide } from '@shared/deck.js';

export interface PdfExportChoice {
  includeEachBuildStage: boolean;
  /** The slides to export, in deck order; undefined for the whole deck. */
  slideIds?: string[];
}

/** What an export can be limited to: the editor's current slide and rail selection. */
export interface ExportScopeSource {
  deck: { slides: Slide[] };
  slideIndex: number;
  slideSelection: ReadonlySet<string>;
}

/**
 * The "Slides" picker both export dialogs share: all, current or selected
 * slides, with a count of what will actually be exported. Hidden slides never
 * are, so a scope of only hidden slides disables Export.
 */
export function createExportSlideScope(source: ExportScopeSource, submit: HTMLButtonElement): {
  elements: HTMLElement[];
  select: HTMLSelectElement;
  slideIds: () => string[] | undefined;
} {
  const { deck, slideIndex, slideSelection } = source;
  const field = document.createElement('label');
  field.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = 'Slides';
  const select = document.createElement('select');
  for (const [value, text] of [['all', 'All slides'], ['current', 'Current slide'], ['selected', 'Selected slides']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
  field.append(caption, select);
  const detail = document.createElement('p');
  detail.className = 'web-export-detail';
  detail.id = 'export-slide-scope-detail';
  detail.setAttribute('role', 'status');
  select.setAttribute('aria-describedby', detail.id);
  const targets = (): Slide[] => (
    select.value === 'current' ? deck.slides.slice(slideIndex, slideIndex + 1)
      : select.value === 'selected' ? deck.slides.filter((slide) => slideSelection.has(slide.id))
        : deck.slides
  );
  const update = (): void => {
    const slides = targets();
    const count = slides.filter((slide) => !slide.skipped).length;
    detail.textContent = `${slides.length} in scope; ${count} to export. Hidden slides are excluded.`;
    submit.disabled = count === 0;
  };
  select.addEventListener('change', update);
  update();
  return {
    elements: [field, detail],
    select,
    slideIds: () => (select.value === 'all' ? undefined : targets().map((slide) => slide.id)),
  };
}

/** Ask for the one PDF-specific option without leaving the editor's UI. */
export function showPdfExportDialog(source: ExportScopeSource): Promise<PdfExportChoice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'workflow-overlay';

    const dialog = document.createElement('section');
    dialog.className = 'workflow-dialog pdf-export-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pdf-export-title');

    const title = document.createElement('h2');
    title.id = 'pdf-export-title';
    title.textContent = 'Export PDF';

    const option = document.createElement('label');
    option.className = 'field-check pdf-export-builds';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const optionText = document.createElement('span');
    optionText.textContent = 'Include each stage of builds';
    option.append(checkbox, optionText);

    const actions = document.createElement('div');
    actions.className = 'workflow-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'primary';
    submit.textContent = 'Export';
    actions.append(cancel, submit);
    const scope = createExportSlideScope(source, submit);

    let finished = false;
    const finish = (choice: PdfExportChoice | null): void => {
      if (finished) return;
      finished = true;
      overlay.remove();
      resolve(choice);
    };
    cancel.addEventListener('click', () => finish(null));
    submit.addEventListener('click', () => {
      if (!submit.disabled) finish({ includeEachBuildStage: checkbox.checked, slideIds: scope.slideIds() });
    });
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(null);
    });

    dialog.append(title, ...scope.elements, option, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    scope.select.focus();
  });
}
